// Pure rules for the Remote view settings and the top bar Remote pill. No Electron or React here, so Node can test them.

/** The 4-digit PIN for "Generate PIN". `randomInt(max)` returns an integer in [0, max); it is crypto-backed in the app. */
export function generatePin(randomInt) {
  return String(randomInt(10000)).padStart(4, '0');
}

/** Why `portText` cannot be saved for a viewer, or null. `otherPort` is the other viewer's saved or typed port. */
export function portProblem(portText, otherPort, otherName, min = 1024, max = 65535) {
  const n = Number(portText);
  if (String(portText).trim() === '' || !Number.isInteger(n) || n < min || n > max) return `Use a port from ${min} to ${max}.`;
  if (n === otherPort) return `Port ${n} is already used by the ${otherName} viewer. Choose a different port.`;
  return null;
}

/** What scanning a viewer's QR code opens. The Secondary QR follows the "QR code opens the TV page" switch. */
export function qrTargetBadge(role, opensTv) {
  if (role === 'primary') return 'Opens Primary Controller';
  return opensTv ? 'Opens Smart TV (16:9)' : 'Opens Phone Mirror';
}

/** The top bar Remote pill: on when either viewer is listening, with the device count only when something is connected. */
export function remotePillLabel(status) {
  const on = Boolean(status && (status.primary?.running || status.secondary?.running));
  const devices = on ? Number(status.devices) || 0 : 0;
  return { on, devices, text: on ? (devices > 0 ? `Remote · ON · ${devices}` : 'Remote · ON') : 'Remote · OFF' };
}

/** The viewer a client row belongs to: a Smart TV, or the viewer it is connected to. */
export function clientRole(role, client) {
  if (client.tv) return 'Smart TV';
  return role === 'primary' ? 'Primary' : 'Secondary';
}

/** Every connected client across both viewers, with the viewer, the role label, and the oldest first. */
export function allClients(status) {
  return ['primary', 'secondary']
    .flatMap((role) => (status[role]?.clients ?? []).map((client) => ({ ...client, viewer: role, roleLabel: clientRole(role, client) })))
    .sort((a, b) => a.since - b.since);
}

/** The label in the Network Adapter dropdown. */
export function adapterLabel(adapter) {
  const kind = { wifi: 'Wi-Fi', wired: 'Cable', virtual: 'Virtual', other: 'Network' }[adapter.kind] ?? 'Network';
  return `${adapter.name} · ${adapter.address} (${kind})`;
}

/**
 * Turns the probes into the Check LAN & Firewall message. `viewers` is `[{ name, port, listening, devices }]` for the viewers that are
 * running; `firewall` is `{ profile, enabled }` or null when it could not be read. A probe from the laptop itself cannot cross the firewall,
 * so a connected phone is the only proof that another device gets through.
 */
export function lanVerdict({ ip, viewers, firewall }) {
  if (!ip) return { level: 'bad', text: 'No local network address was found. Connect this laptop to Wi-Fi or a cable.' };
  if (viewers.length === 0) return { level: 'warn', text: 'Turn on the Primary or Secondary viewer first, then check again.' };
  const down = viewers.filter((v) => !v.listening);
  if (down.length) {
    return { level: 'bad', text: `${down.map((v) => `${v.name} (:${v.port})`).join(' and ')} did not answer on ${ip}. Turn the viewer off and on, or pick another port.` };
  }
  if (viewers.some((v) => v.devices > 0)) {
    return { level: 'ok', text: `Reachable: a device on the local network is already connected to ${ip}.` };
  }
  const ports = viewers.map((v) => v.port).join(' and ');
  if (firewall && firewall.enabled) {
    return {
      level: 'warn',
      text: `Listening on ${ip}. Windows Firewall is on (${firewall.profile ?? 'current'} profile), so a phone may be blocked. Open ${ports} on a phone; if it does not load, allow this app through Windows Firewall on private networks.`,
    };
  }
  return { level: 'ok', text: `Listening on ${ip} (${ports}). Windows Firewall is not blocking this network. Open the address on a phone to confirm.` };
}
