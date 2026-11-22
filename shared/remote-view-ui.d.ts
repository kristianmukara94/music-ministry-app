export function generatePin(randomInt: (max: number) => number): string;
export function portProblem(portText: string, otherPort: number, otherName: string, min?: number, max?: number): string | null;
export function qrTargetBadge(role: 'primary' | 'secondary', opensTv: boolean): string;
export function remotePillLabel(status: { primary?: { running: boolean }; secondary?: { running: boolean }; devices?: number } | null): {
  on: boolean;
  devices: number;
  text: string;
};
export interface ClientRow {
  ip: string;
  label: string;
  userAgent: string;
  since: number;
  tabs: number;
  tv?: boolean;
  viewer: 'primary' | 'secondary';
  roleLabel: 'Primary' | 'Secondary' | 'Smart TV';
}
export function allClients(status: { primary?: { clients?: unknown[] }; secondary?: { clients?: unknown[] } }): ClientRow[];
export function adapterLabel(adapter: { name: string; address: string; kind: string }): string;
export interface LanViewer {
  name: string;
  port: number;
  listening: boolean;
  devices: number;
}
export function lanVerdict(input: { ip: string | null; viewers: LanViewer[]; firewall: { profile: string | null; enabled: boolean } | null }): {
  level: 'ok' | 'warn' | 'bad';
  text: string;
};
