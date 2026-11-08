// display-matrix: the physical display topology of this PC, for the sanctuary EDID lock (electron/edid-watchdog.js).
//
// For every active display path it reports the GPU output it leaves from and the monitor on the end of the cable:
//   - Windows' Connecting and Configuring Displays API (QueryDisplayConfig + DisplayConfigGetDeviceInfo): the adapter's device path, the
//     target (GPU output) id, the connector type (HDMI, DisplayPort...), the connector instance, the monitor's EDID ids, its device path,
//     the GDI name it has today (\\.\DISPLAY2) and its desktop rectangle in physical pixels.
//   - SetupAPI: the monitor's raw EDID block, read from its device registry key. It is parsed in JavaScript, where it can be tested.
//   - DXGI (CreateDXGIFactory1): each adapter's name, to tell the operator which graphics card a port is on.
//
// Adapter LUIDs are reported but must not be used as identity: Windows hands out new ones at every boot and driver restart.
//
// It also exports getHardwareIdentity() for the sanctuary hardware lock (electron/hardware-id.js): the raw SMBIOS table and the TPM family.
//
// Plain Node-API (C), version 8, so one build loads in Node (the tests) and in Electron alike. Windows only.

#ifndef NAPI_VERSION
#define NAPI_VERSION 8
#endif
#include <node_api.h>

#include <windows.h>
#include <setupapi.h>
#include <dxgi.h>

#include <string>
#include <vector>

namespace {

// GUID_DEVINTERFACE_MONITOR, written out so no extra header or initguid juggling is needed.
const GUID kMonitorInterface = {0xe6f07b5f, 0xee97, 0x4a90, {0xb0, 0x76, 0x33, 0xf5, 0x7b, 0xf4, 0xea, 0xa7}};

std::string Utf8(const wchar_t* wide) {
  if (!wide || !*wide) return std::string();
  int size = WideCharToMultiByte(CP_UTF8, 0, wide, -1, nullptr, 0, nullptr, nullptr);
  if (size <= 1) return std::string();
  std::string out(static_cast<size_t>(size - 1), '\0');
  WideCharToMultiByte(CP_UTF8, 0, wide, -1, out.data(), size, nullptr, nullptr);
  return out;
}

std::string LuidText(const LUID& luid) {
  char buf[32];
  snprintf(buf, sizeof buf, "%08lx:%08lx", static_cast<unsigned long>(luid.HighPart), static_cast<unsigned long>(luid.LowPart));
  return buf;
}

bool SameLuid(const LUID& a, const LUID& b) { return a.HighPart == b.HighPart && a.LowPart == b.LowPart; }

// ---- Node-API helpers. A failed call leaves the value undefined rather than throwing: the caller checks what it needs. ----

napi_value Str(napi_env env, const std::string& s) {
  napi_value v = nullptr;
  napi_create_string_utf8(env, s.c_str(), s.size(), &v);
  return v;
}
napi_value Num(napi_env env, double d) {
  napi_value v = nullptr;
  napi_create_double(env, d, &v);
  return v;
}
napi_value Bool(napi_env env, bool b) {
  napi_value v = nullptr;
  napi_get_boolean(env, b, &v);
  return v;
}
napi_value Null(napi_env env) {
  napi_value v = nullptr;
  napi_get_null(env, &v);
  return v;
}
void Set(napi_env env, napi_value obj, const char* key, napi_value value) {
  if (value) napi_set_named_property(env, obj, key, value);
}

// ---- SetupAPI: the raw EDID of the monitor at a device interface path (from DISPLAYCONFIG_TARGET_DEVICE_NAME.monitorDevicePath). ----

std::vector<BYTE> ReadEdid(const wchar_t* interfacePath) {
  std::vector<BYTE> edid;
  if (!interfacePath || !*interfacePath) return edid;
  HDEVINFO set = SetupDiGetClassDevsW(&kMonitorInterface, nullptr, nullptr, DIGCF_DEVICEINTERFACE | DIGCF_PRESENT);
  if (set == INVALID_HANDLE_VALUE) return edid;

  SP_DEVICE_INTERFACE_DATA iface = {};
  iface.cbSize = sizeof iface;
  if (SetupDiOpenDeviceInterfaceW(set, interfacePath, 0, &iface)) {
    DWORD needed = 0;
    SetupDiGetDeviceInterfaceDetailW(set, &iface, nullptr, 0, &needed, nullptr);
    if (needed > 0) {
      std::vector<BYTE> detailBuf(needed);
      auto* detail = reinterpret_cast<SP_DEVICE_INTERFACE_DETAIL_DATA_W*>(detailBuf.data());
      detail->cbSize = sizeof(SP_DEVICE_INTERFACE_DETAIL_DATA_W);
      SP_DEVINFO_DATA dev = {};
      dev.cbSize = sizeof dev;
      if (SetupDiGetDeviceInterfaceDetailW(set, &iface, detail, needed, nullptr, &dev)) {
        HKEY key = SetupDiOpenDevRegKey(set, &dev, DICS_FLAG_GLOBAL, 0, DIREG_DEV, KEY_READ);
        if (key != INVALID_HANDLE_VALUE) {
          DWORD type = 0;
          DWORD size = 0;
          // An EDID is 128 bytes per block, at most a few blocks. Anything far larger is not one.
          if (RegQueryValueExW(key, L"EDID", nullptr, &type, nullptr, &size) == ERROR_SUCCESS && type == REG_BINARY && size > 0 &&
              size <= 32768) {
            edid.resize(size);
            if (RegQueryValueExW(key, L"EDID", nullptr, &type, edid.data(), &size) == ERROR_SUCCESS) edid.resize(size);
            else edid.clear();
          }
          RegCloseKey(key);
        }
      }
    }
  }
  SetupDiDestroyDeviceInfoList(set);
  return edid;
}

// ---- DXGI: the adapters, for their names. ----

struct Adapter {
  LUID luid;
  std::string name;
  unsigned vendorId;
  unsigned deviceId;
};

std::vector<Adapter> ReadAdapters() {
  std::vector<Adapter> adapters;
  IDXGIFactory1* factory = nullptr;
  if (FAILED(CreateDXGIFactory1(__uuidof(IDXGIFactory1), reinterpret_cast<void**>(&factory))) || !factory) return adapters;
  IDXGIAdapter1* adapter = nullptr;
  for (UINT i = 0; factory->EnumAdapters1(i, &adapter) != DXGI_ERROR_NOT_FOUND; ++i) {
    DXGI_ADAPTER_DESC1 desc = {};
    if (SUCCEEDED(adapter->GetDesc1(&desc))) {
      adapters.push_back({desc.AdapterLuid, Utf8(desc.Description), desc.VendorId, desc.DeviceId});
    }
    adapter->Release();
  }
  factory->Release();
  return adapters;
}

// ---- The query ----

napi_value Fail(napi_env env, const char* what, LONG code) {
  char buf[160];
  snprintf(buf, sizeof buf, "%s failed (Win32 error %ld)", what, static_cast<long>(code));
  napi_throw_error(env, "DISPLAY_MATRIX_QUERY", buf);
  return nullptr;
}

/**
 * getHardwareDisplayTopology() -> { monitors: [...], adapters: [...] }
 * Throws if Windows refuses the display configuration query. A monitor whose EDID cannot be read is still listed, with `edid: null`.
 */
napi_value GetHardwareDisplayTopology(napi_env env, napi_callback_info) {
  std::vector<DISPLAYCONFIG_PATH_INFO> paths;
  std::vector<DISPLAYCONFIG_MODE_INFO> modes;
  LONG rc = ERROR_SUCCESS;
  // The topology can change between asking for the sizes and asking for the paths. Windows then says the buffer is too small: ask again.
  for (int attempt = 0; attempt < 5; ++attempt) {
    UINT32 pathCount = 0;
    UINT32 modeCount = 0;
    rc = GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &pathCount, &modeCount);
    if (rc != ERROR_SUCCESS) return Fail(env, "GetDisplayConfigBufferSizes", rc);
    paths.resize(pathCount);
    modes.resize(modeCount);
    rc = QueryDisplayConfig(QDC_ONLY_ACTIVE_PATHS, &pathCount, paths.data(), &modeCount, modes.data(), nullptr);
    if (rc == ERROR_SUCCESS) {
      paths.resize(pathCount);
      modes.resize(modeCount);
      break;
    }
    if (rc != ERROR_INSUFFICIENT_BUFFER) return Fail(env, "QueryDisplayConfig", rc);
  }
  if (rc != ERROR_SUCCESS) return Fail(env, "QueryDisplayConfig", rc);

  const std::vector<Adapter> adapters = ReadAdapters();

  napi_value monitors = nullptr;
  napi_create_array(env, &monitors);
  uint32_t index = 0;

  for (const DISPLAYCONFIG_PATH_INFO& path : paths) {
    if (!(path.flags & DISPLAYCONFIG_PATH_ACTIVE)) continue;

    DISPLAYCONFIG_SOURCE_DEVICE_NAME source = {};
    source.header.type = DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME;
    source.header.size = sizeof source;
    source.header.adapterId = path.sourceInfo.adapterId;
    source.header.id = path.sourceInfo.id;
    const bool haveSource = DisplayConfigGetDeviceInfo(&source.header) == ERROR_SUCCESS;

    DISPLAYCONFIG_TARGET_DEVICE_NAME target = {};
    target.header.type = DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME;
    target.header.size = sizeof target;
    target.header.adapterId = path.targetInfo.adapterId;
    target.header.id = path.targetInfo.id;
    const bool haveTarget = DisplayConfigGetDeviceInfo(&target.header) == ERROR_SUCCESS;

    DISPLAYCONFIG_ADAPTER_NAME adapterName = {};
    adapterName.header.type = DISPLAYCONFIG_DEVICE_INFO_GET_ADAPTER_NAME;
    adapterName.header.size = sizeof adapterName;
    adapterName.header.adapterId = path.targetInfo.adapterId;
    const bool haveAdapter = DisplayConfigGetDeviceInfo(&adapterName.header) == ERROR_SUCCESS;

    napi_value m = nullptr;
    napi_create_object(env, &m);

    Set(env, m, "gdiDeviceName", Str(env, haveSource ? Utf8(source.viewGdiDeviceName) : std::string()));
    Set(env, m, "adapterLuid", Str(env, LuidText(path.targetInfo.adapterId)));
    Set(env, m, "adapterDevicePath", Str(env, haveAdapter ? Utf8(adapterName.adapterDevicePath) : std::string()));
    Set(env, m, "sourceId", Num(env, path.sourceInfo.id));
    Set(env, m, "targetId", Num(env, path.targetInfo.id));
    Set(env, m, "outputTechnology", Num(env, static_cast<double>(static_cast<int64_t>(path.targetInfo.outputTechnology))));
    Set(env, m, "connectorInstance", haveTarget ? Num(env, target.connectorInstance) : Null(env));
    Set(env, m, "friendlyName", Str(env, haveTarget ? Utf8(target.monitorFriendlyDeviceName) : std::string()));
    Set(env, m, "monitorDevicePath", Str(env, haveTarget ? Utf8(target.monitorDevicePath) : std::string()));
    const bool idsValid = haveTarget && target.flags.edidIdsValid;
    Set(env, m, "edidManufactureId", idsValid ? Num(env, target.edidManufactureId) : Null(env));
    Set(env, m, "edidProductCodeId", idsValid ? Num(env, target.edidProductCodeId) : Null(env));

    const DISPLAYCONFIG_RATIONAL& rate = path.targetInfo.refreshRate;
    Set(env, m, "refreshHz", rate.Denominator ? Num(env, static_cast<double>(rate.Numerator) / rate.Denominator) : Null(env));

    // The desktop rectangle, in physical pixels, from the path's source mode.
    napi_value rect = Null(env);
    const UINT32 modeIdx = path.sourceInfo.modeInfoIdx;
    if (modeIdx != DISPLAYCONFIG_PATH_MODE_IDX_INVALID && modeIdx < modes.size() &&
        modes[modeIdx].infoType == DISPLAYCONFIG_MODE_INFO_TYPE_SOURCE) {
      const DISPLAYCONFIG_SOURCE_MODE& sm = modes[modeIdx].sourceMode;
      napi_create_object(env, &rect);
      Set(env, rect, "x", Num(env, sm.position.x));
      Set(env, rect, "y", Num(env, sm.position.y));
      Set(env, rect, "width", Num(env, sm.width));
      Set(env, rect, "height", Num(env, sm.height));
    }
    Set(env, m, "physicalBounds", rect);

    std::string gpuName;
    for (const Adapter& a : adapters) {
      if (SameLuid(a.luid, path.targetInfo.adapterId)) gpuName = a.name;
    }
    Set(env, m, "gpuName", Str(env, gpuName));

    const std::vector<BYTE> edid = haveTarget ? ReadEdid(target.monitorDevicePath) : std::vector<BYTE>();
    if (edid.empty()) {
      Set(env, m, "edid", Null(env));
    } else {
      napi_value buffer = nullptr;
      void* copy = nullptr;
      napi_create_buffer_copy(env, edid.size(), edid.data(), &copy, &buffer);
      Set(env, m, "edid", buffer);
    }

    napi_set_element(env, monitors, index++, m);
  }

  napi_value adapterList = nullptr;
  napi_create_array(env, &adapterList);
  uint32_t ai = 0;
  for (const Adapter& a : adapters) {
    napi_value o = nullptr;
    napi_create_object(env, &o);
    Set(env, o, "luid", Str(env, LuidText(a.luid)));
    Set(env, o, "name", Str(env, a.name));
    Set(env, o, "vendorId", Num(env, a.vendorId));
    Set(env, o, "deviceId", Num(env, a.deviceId));
    napi_set_element(env, adapterList, ai++, o);
  }

  napi_value result = nullptr;
  napi_create_object(env, &result);
  Set(env, result, "monitors", monitors);
  Set(env, result, "adapters", adapterList);
  return result;
}

// ---- Hardware identity, for the sanctuary hardware lock (electron/hardware-id.js). ----

// Tbsi_GetDeviceInfo from tbs.dll, looked up at run time: no tbs.h / tbs.lib version juggling, and a PC without the TPM Base Services
// (very old or stripped Windows) still loads the addon. Values from tbs.h.
typedef UINT32(WINAPI* TbsiGetDeviceInfoFn)(UINT32 size, PVOID info);
struct TpmDeviceInfo {
  UINT32 structVersion;
  UINT32 tpmVersion;  // 1 = TPM 1.2, 2 = TPM 2.0
  UINT32 tpmInterfaceType;
  UINT32 tpmImpRevision;
};
const UINT32 kTbsSuccess = 0;
const UINT32 kTbsTpmNotFound = 0x8028400F;

/**
 * getHardwareIdentity() -> { smbios: Buffer | null, tpm: { status: 'present' | 'absent' | 'error', version: number, code: number } }
 * - smbios: the raw SMBIOS table exactly as GetSystemFirmwareTable('RSMB') returns it (8-byte RawSMBIOSData header, then the
 *   structures). The motherboard UUID (type 1) and the processor id (type 4) are parsed from it in JavaScript, where it can be tested.
 * - tpm: whether the TPM Base Services see a TPM, and its family. Both calls work without administrator rights; Get-Tpm and the
 *   Win32_Tpm WMI class do not.
 * Never throws: whatever cannot be read is null / 'error', and the caller decides.
 */
napi_value GetHardwareIdentity(napi_env env, napi_callback_info) {
  napi_value result = nullptr;
  napi_create_object(env, &result);

  napi_value smbios = Null(env);
  const DWORD rsmb = 'RSMB';
  UINT size = GetSystemFirmwareTable(rsmb, 0, nullptr, 0);
  if (size > 0) {
    std::vector<BYTE> table(size);
    UINT got = GetSystemFirmwareTable(rsmb, 0, table.data(), size);
    if (got > 0 && got <= size) {
      void* copy = nullptr;
      napi_create_buffer_copy(env, got, table.data(), &copy, &smbios);
    }
  }
  Set(env, result, "smbios", smbios);

  napi_value tpm = nullptr;
  napi_create_object(env, &tpm);
  const char* status = "error";
  UINT32 version = 0;
  UINT32 code = 0;
  static HMODULE tbs = LoadLibraryExW(L"tbs.dll", nullptr, LOAD_LIBRARY_SEARCH_SYSTEM32);
  auto getInfo = tbs ? reinterpret_cast<TbsiGetDeviceInfoFn>(reinterpret_cast<void*>(GetProcAddress(tbs, "Tbsi_GetDeviceInfo"))) : nullptr;
  if (getInfo) {
    TpmDeviceInfo info = {};
    code = getInfo(static_cast<UINT32>(sizeof info), &info);
    if (code == kTbsSuccess) {
      status = "present";
      version = info.tpmVersion;
    } else if (code == kTbsTpmNotFound) {
      status = "absent";
    }
  }
  Set(env, tpm, "status", Str(env, status));
  Set(env, tpm, "version", Num(env, version));
  Set(env, tpm, "code", Num(env, code));
  Set(env, result, "tpm", tpm);
  return result;
}

}  // namespace

NAPI_MODULE_INIT() {
  napi_value fn = nullptr;
  napi_create_function(env, "getHardwareDisplayTopology", NAPI_AUTO_LENGTH, GetHardwareDisplayTopology, nullptr, &fn);
  napi_set_named_property(env, exports, "getHardwareDisplayTopology", fn);
  napi_value identity = nullptr;
  napi_create_function(env, "getHardwareIdentity", NAPI_AUTO_LENGTH, GetHardwareIdentity, nullptr, &identity);
  napi_set_named_property(env, exports, "getHardwareIdentity", identity);
  return exports;
}
