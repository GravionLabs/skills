import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;
const SCRIPT = path.resolve(
  __dirname,
  '../../../skills/vault/vault-pdf/scripts/Export-VaultPdf.ps1',
);

// Fake nixe: writes the HTML given by --out; NIXE_FAKE=fail exits 1, =async writes it 0.6 s later
// (a running Nixe exports in its window), =wide adds a timeline SVG too wide for A4.
const FAKE_NIXE = `
$out = $args[$args.IndexOf('--out') + 1]
$html = "<html><head><style>@page { size: A4; margin: 18mm; }</style></head><body>$($args[1])"
if ($env:NIXE_FAKE -eq 'wide') { $html += '<svg viewBox="100 -61 3390 973" aria-roledescription="timeline"></svg>' }
$html += '</body></html>'
if ($env:NIXE_FAKE -eq 'fail') { [Console]::Error.WriteLine('no such note'); exit 1 }
if ($env:NIXE_FAKE -eq 'async') {
  $cmd = "Start-Sleep -Milliseconds 600; Set-Content -LiteralPath '$out' -Value '$html'"
  Start-Process pwsh -ArgumentList '-NoProfile', '-Command', $cmd | Out-Null
  exit 0
}
Set-Content -LiteralPath $out -Value $html
exit 0
`;
// Fake browser: copies the page to the --print-to-pdf file.
const FAKE_BROWSER = `
$pdf = ($args | Where-Object { $_ -like '--print-to-pdf=*' }) -replace '^--print-to-pdf=', ''
Set-Content -LiteralPath $pdf -Value 'PDF'
`;

describe.skipIf(!hasPwsh)('Export-VaultPdf.ps1', () => {
  let tmp: string;
  let vault: string;
  let nixe: string;
  let browser: string;

  beforeAll(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vaultpdf-')));
    vault = path.join(tmp, 'vault');
    nixe = path.join(tmp, 'nixe.ps1');
    browser = path.join(tmp, 'browser.ps1');
    fs.writeFileSync(nixe, FAKE_NIXE);
    fs.writeFileSync(browser, FAKE_BROWSER);
    const files = {
      '.nixe/config.json': JSON.stringify({
        language: 'de',
        folders: { inbox: 'Eingang', sources: 'Quellen' },
      }),
      'Fach/Thema/Thema – Zusammenfassung.md': '# S',
      'Fach/Thema/Thema – Zeitstrahl.md': '# T',
      'Fach/Thema/Thema – Karteikarten.md': '# K',
      'Fach/Thema/Quellen/Thema – Zusammenfassung.md': '# copy in sources',
      'Fach/.hidden/Thema – Zusammenfassung.md': '# hidden',
      'Eingang/Neu – Zusammenfassung.md': '# inbox',
    };
    for (const [f, c] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(vault, f)), { recursive: true });
      fs.writeFileSync(path.join(vault, f), c);
    }
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const run = (args: string[], fake = '') =>
    spawnSync(
      'pwsh',
      ['-NoProfile', '-File', SCRIPT, '-Vault', vault, '-Nixe', nixe, '-Browser', browser, ...args],
      { encoding: 'utf8', env: { ...process.env, NIXE_FAKE: fake } },
    );

  it('prints the matching notes of a folder and skips inbox, sources and hidden folders', () => {
    // comma-joined patterns: what `pwsh -File … -Filter 'a','b'` passes
    const r = run(['-Path', '.', '-Filter', '* – Zusammenfassung.md,* – Zeitstrahl.md']);
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split(/\r?\n/)).toEqual([
      'Fach/Thema/Thema – Zeitstrahl.pdf',
      'Fach/Thema/Thema – Zusammenfassung.pdf',
    ]);
    expect(fs.existsSync(path.join(vault, 'Fach/Thema/Thema – Zeitstrahl.pdf'))).toBe(true);
    expect(fs.existsSync(path.join(vault, 'Fach/Thema/Quellen/Thema – Zusammenfassung.pdf'))).toBe(
      false,
    );
  });

  it('writes one note into -OutDir and waits for an asynchronous export', () => {
    const r = run(['-Path', 'Fach/Thema/Thema – Karteikarten.md', '-OutDir', 'Export'], 'async');
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('Export/Thema – Karteikarten.pdf');
  });

  it('warns when a timeline is too wide for the page', () => {
    const r = run(['-Path', 'Fach/Thema/Thema – Zeitstrahl.md'], 'wide');
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toMatch(
      /timeline too wide for the page, labels print at about 3\.1 px/,
    );
  });

  it('stops with the note when nixe fails', () => {
    const r = run(['-Path', 'Fach/Thema/Thema – Zeitstrahl.md'], 'fail');
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(
      /nixe export failed \(exit 1\): Fach\/Thema\/Thema – Zeitstrahl\.md/,
    );
  });
});
