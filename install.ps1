# install.ps1 - Install dsh-telegram-notify the documented way:
#   dsh plugin --profile <name> add <this package>
# The package declares dsh.bundle.patch, so mounting is automatic after add.
# Usage: powershell -File install.ps1 [-Profile web] [-Source <path>]
param(
  [string]$Profile = 'web',
  [string]$Source = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'

$dsh = Get-Command dsh -ErrorAction SilentlyContinue
if ($dsh) {
  & dsh plugin --profile $Profile add $Source
} else {
  Write-Host "[info] 'dsh' not on PATH, falling back to npx @deepseek-ai/dsh"
  & npx --yes '@deepseek-ai/dsh' plugin --profile $Profile add $Source
}
if ($LASTEXITCODE -ne 0) { throw "dsh plugin add failed with exit code $LASTEXITCODE" }

Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Put your credentials in %USERPROFILE%\.dsh\profiles\$Profile\cordis.patch.yml:"
Write-Host "       - id: telegram-notify"
Write-Host "         config:"
Write-Host "           token: `"<bot token>`"   # or env TELEGRAM_BOT_TOKEN"
Write-Host "           chatId: `"<chat id>`"    # or env TELEGRAM_CHAT_ID"
Write-Host "           proxy: `"http://127.0.0.1:7890`"  # if api.telegram.org is unreachable"
Write-Host "  2. Restart DSH (close and rerun: dsh $Profile) so the plugin loads"
Write-Host "  3. You should receive a startup message in Telegram"
