// Prepare private credentials and a relocatable user-service file; never install automatically.
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
if (/[\r\n]/.test(root)) throw new Error('Checkout path must not contain line breaks');
const runtime = `${root}/local-runtime`;
mkdirSync(runtime, { recursive: true, mode: 0o700 });
chmodSync(runtime, 0o700);
const env = `${runtime}/bridge.env`;
if (existsSync(env)) {
  if (!/^TB_AUTH_TOKEN=[a-f0-9]{64}\n$/.test(readFileSync(env, 'utf8'))) {
    throw new Error('Invalid existing credentials; refusing to replace them');
  }
} else writeFileSync(env, `TB_AUTH_TOKEN=${randomBytes(32).toString('hex')}\n`, { mode: 0o600, flag: 'wx' });
chmodSync(env, 0o600);
const quote = value => '"' + value.replace(/[%\\"]/g, c => c === '%' ? '%%' : '\\' + c) + '"';
writeFileSync(`${runtime}/thunderbird-cli-bridge.service`, `[Unit]
Description=Thunderbird CLI authenticated local bridge

[Service]
Type=simple
WorkingDirectory=${root.replaceAll('%', '%%')}
Environment=TB_AUTH_TOKEN=
EnvironmentFile=${env.replaceAll('%', '%%')}
ExecStart=${quote(process.execPath)} ${quote(root + '/bridge/bridge.js')}
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true

[Install]
WantedBy=default.target
`, { mode: 0o600 });
chmodSync(`${root}/tb`, 0o755);
console.log('Private runtime and user-service template ready in local-runtime/');
