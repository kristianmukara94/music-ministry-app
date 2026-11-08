{
  # The display-matrix addon (edid_reader.cc). Built by tools/build-native.mjs, which copies the result to electron/display-matrix.node.
  # Node-API, so the one build loads in both Node (tests) and Electron. Windows only.
  "targets": [
    {
      "target_name": "display_matrix",
      "sources": ["edid_reader.cc"],
      "defines": ["NAPI_VERSION=8", "UNICODE", "_UNICODE", "NOMINMAX", "WIN32_LEAN_AND_MEAN"],
      "libraries": ["setupapi.lib", "dxgi.lib", "user32.lib", "advapi32.lib"],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1,
          "WarningLevel": 4
        }
      }
    }
  ]
}
