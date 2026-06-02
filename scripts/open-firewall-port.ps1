# Libera a porta do backend para rede privada (acesso pelo celular na mesma Wi-Fi).
# Execute como Administrador.

param(
  [int]$Port = 3001,
  [string]$RuleName = "TranscricaoVideo-$Port"
)

$existing = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Regra ja existe: $RuleName"
  exit 0
}

New-NetFirewallRule `
  -DisplayName $RuleName `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort $Port `
  -Profile Private `
  | Out-Null

Write-Host "Firewall liberado na porta TCP $Port (perfil Private)."
Write-Host "Teste no celular: http://<IP-DO-NOTEBOOK>:$Port/debug"
