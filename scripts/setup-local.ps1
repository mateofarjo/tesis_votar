<#
.SYNOPSIS
  Prepara el entorno local de Vot.Ar Blockchain sin cuentas externas.
  Requiere: Docker Desktop corriendo, Node.js 18+, npm.

PASOS QUE EJECUTA:
  1. Levanta PostgreSQL con Docker Compose
  2. Genera el par de claves RSA (2048 bits)
  3. Escribe .env.local con todos los valores de local-dev
  4. Corre las migraciones de Prisma
  5. Inicia el nodo Hardhat local en background
  6. Despliega el contrato y escribe CONTRACT_ADDRESS en .env.local
#>

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot

Write-Host ""
Write-Host "=== Vot.Ar Blockchain — Setup local ===" -ForegroundColor Cyan
Write-Host ""

# ── 1. PostgreSQL ──────────────────────────────────────────────────────────────
Write-Host "[1/6] Levantando PostgreSQL con Docker..." -ForegroundColor Yellow
Set-Location $ProjectRoot
docker compose up -d --wait
if ($LASTEXITCODE -ne 0) {
    Write-Error "Docker Compose fallo. Asegurate de que Docker Desktop este corriendo."
    exit 1
}
Write-Host "      PostgreSQL listo en localhost:5432" -ForegroundColor Green

# ── 2. Generar claves RSA ──────────────────────────────────────────────────────
Write-Host "[2/6] Generando par de claves RSA 2048 bits..." -ForegroundColor Yellow
$KeyArgs = @(
    "ts-node",
    "-e",
    "const { generateKeyPair } = require('./lib/blindSignature'); generateKeyPair();"
)
$KeyOutput = & npx @KeyArgs 2>&1
# El output tiene dos lineas: RSA_PRIVATE_KEY_PEM="..." y RSA_PUBLIC_KEY_PEM="..."
$PrivateLine = ($KeyOutput | Select-String 'RSA_PRIVATE_KEY_PEM=').Line
$PublicLine  = ($KeyOutput | Select-String 'RSA_PUBLIC_KEY_PEM=').Line

if (-not $PrivateLine -or -not $PublicLine) {
    Write-Error "No se pudieron generar las claves RSA. Revisa el output de ts-node."
    Write-Host $KeyOutput
    exit 1
}
Write-Host "      Claves generadas." -ForegroundColor Green

# Extraer los valores entre comillas (puede contener \n)
$RsaPrivate = ($PrivateLine -replace '^RSA_PRIVATE_KEY_PEM="(.+)"$', '$1')
$RsaPublic  = ($PublicLine  -replace '^RSA_PUBLIC_KEY_PEM="(.+)"$',  '$1')

# ── 3. Escribir .env.local ─────────────────────────────────────────────────────
Write-Host "[3/6] Escribiendo .env.local..." -ForegroundColor Yellow

# Cuenta 0 de Hardhat (clave privada determinista publica, solo para dev local)
$HardhatPrivKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

$EnvContent = @"
# Generado por scripts/setup-local.ps1
# SOLO PARA DESARROLLO LOCAL — no commitear

DATABASE_URL=postgresql://votar:votar_local_pw@localhost:5432/votar_blockchain?schema=public

NEXTAUTH_SECRET=dev-secret-local-inseguro-cambiar-en-produccion
NEXTAUTH_URL=http://localhost:3000

AUTHORITY_USERNAME=autoridad
AUTHORITY_PASSWORD=autoridad123

# Hardhat local (chain id 31337)
ALCHEMY_RPC_URL=http://127.0.0.1:8545
PRIVATE_KEY_AUTORIDAD=$HardhatPrivKey

# Se completa en el paso [5] despues del deploy
CONTRACT_ADDRESS=

# Claves RSA generadas en este setup
$PrivateLine
$PublicLine

# Candidatos para el contrato local
CANDIDATOS=Lista A,Lista B,Lista C

# Veriff — NO necesario en dev (usamos /api/test/trigger-veriff)
VERIFF_API_KEY=dev-placeholder
VERIFF_SECRET_KEY=dev-placeholder
"@

Set-Content -Path "$ProjectRoot\.env.local" -Value $EnvContent -Encoding utf8
Write-Host "      .env.local creado." -ForegroundColor Green

# ── 4. Migraciones Prisma ──────────────────────────────────────────────────────
Write-Host "[4/6] Ejecutando migraciones de Prisma..." -ForegroundColor Yellow
$env:DATABASE_URL = "postgresql://votar:votar_local_pw@localhost:5432/votar_blockchain?schema=public"
npx prisma migrate deploy
if ($LASTEXITCODE -ne 0) { Write-Error "Migraciones fallaron."; exit 1 }
Write-Host "      Base de datos lista." -ForegroundColor Green

# ── 5. Hardhat node ────────────────────────────────────────────────────────────
Write-Host "[5/6] Iniciando nodo Hardhat local en background..." -ForegroundColor Yellow
$HardhatJob = Start-Process -FilePath "npx" -ArgumentList "hardhat","node" `
    -WorkingDirectory $ProjectRoot -PassThru -WindowStyle Minimized
Start-Sleep -Seconds 3
Write-Host "      Nodo Hardhat PID: $($HardhatJob.Id)" -ForegroundColor Green

# ── 6. Deploy del contrato ─────────────────────────────────────────────────────
Write-Host "[6/6] Desplegando contrato VotacionContract al nodo local..." -ForegroundColor Yellow
$env:RSA_PUBLIC_KEY_PEM = $RsaPublic
$env:CANDIDATOS = "Lista A,Lista B,Lista C"
npx hardhat run contracts/scripts/deploy.ts --network localhost
if ($LASTEXITCODE -ne 0) { Write-Error "Deploy fallo."; exit 1 }

# Leer la direccion del contrato del artifact generado
$DeployJson = Get-Content "$ProjectRoot\deployments\localhost.json" | ConvertFrom-Json
$ContractAddress = $DeployJson.contractAddress

# Actualizar CONTRACT_ADDRESS en .env.local
(Get-Content "$ProjectRoot\.env.local") `
    -replace "^CONTRACT_ADDRESS=$", "CONTRACT_ADDRESS=$ContractAddress" |
    Set-Content "$ProjectRoot\.env.local" -Encoding utf8

Write-Host "      Contrato: $ContractAddress" -ForegroundColor Green

# ── Resumen ────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=== Setup completado ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Proximos pasos:" -ForegroundColor White
Write-Host "  npm run dev            <- inicia la app en http://localhost:3000"
Write-Host ""
Write-Host "Para registrar un votante de prueba, usa el flujo normal en /registro"
Write-Host "y luego simula la respuesta de Veriff con:"
Write-Host ""
Write-Host "  POST http://localhost:3000/api/test/trigger-veriff" -ForegroundColor Cyan
Write-Host "  Body: { ""sessionId"": ""<id-de-la-sesion>"", ""type"": ""REGISTRO"" }"
Write-Host ""
Write-Host "El nodo Hardhat corre en background (PID $($HardhatJob.Id))."
Write-Host "Para detenerlo: Stop-Process -Id $($HardhatJob.Id)"
Write-Host ""
