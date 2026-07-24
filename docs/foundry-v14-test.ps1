<#
    Lanza una instancia AISLADA de Foundry v14 para pruebas.

    No toca la instalación de producción ni sus mundos: usa su propia carpeta
    de datos y su propio puerto. La migración de mundos en Foundry es de un
    solo sentido, así que probar v14 sobre los datos reales los convertiría
    sin vuelta atrás — este script existe para que eso no pueda pasar.

    Uso:
        .\foundry-v14-test.ps1
        .\foundry-v14-test.ps1 -AppPath "I:\Foundry_v14_App" -Port 30014
#>

param(
    # Carpeta donde descomprimiste Foundry v14 (la que contiene resources\app\main.js)
    [string] $AppPath  = "I:\Foundry_v14_App",

    # Carpeta de datos de PRUEBAS. Debe ser distinta de la de producción.
    [string] $DataPath = "I:\Foundry_v14_Data",

    [int]    $Port     = 30014
)

$ErrorActionPreference = "Stop"

# Guarda de seguridad: nunca arrancar contra los datos de produccion.
# Se comparan rutas normalizadas, para que "I:\Foundry_Data\" o una ruta
# relativa no burlen la comprobacion.
$productionData = "I:\Foundry_Data"
$normalise = {
    param($p)
    $resolved = Resolve-Path -LiteralPath $p -ErrorAction SilentlyContinue
    if ($resolved) { $resolved.Path.TrimEnd('\').ToLowerInvariant() }
    else { $p.TrimEnd('\').ToLowerInvariant() }
}
if ((& $normalise $DataPath) -eq (& $normalise $productionData)) {
    throw "DataPath apunta a los datos de PRODUCCION ($productionData). Abortado."
}

$main = Join-Path $AppPath "resources\app\main.js"
if (-not (Test-Path $main)) {
    Write-Host "No encuentro Foundry v14 en: $AppPath" -ForegroundColor Red
    Write-Host "Descarga v14 (formato zip/Node, NO el instalador) y descomprimelo alli." -ForegroundColor Yellow
    Write-Host "El instalador sustituiria tu v13 de produccion." -ForegroundColor Yellow
    exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js no esta en el PATH. Instalalo o usa el ejecutable de Foundry." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $DataPath)) {
    New-Item -ItemType Directory -Path $DataPath -Force | Out-Null
    Write-Host "Creada carpeta de datos de pruebas: $DataPath" -ForegroundColor Green
}

Write-Host ""
Write-Host "  Foundry v14 — instancia de PRUEBAS" -ForegroundColor Cyan
Write-Host "  App    : $AppPath"
Write-Host "  Datos  : $DataPath"
Write-Host "  URL    : http://localhost:$Port"
Write-Host ""
Write-Host "  Produccion ($productionData) NO se toca." -ForegroundColor Green
Write-Host "  Manifiesto del modulo para instalar dentro:" -ForegroundColor Cyan
Write-Host "  https://github.com/gmredvelvet-rgb/velvet-mobile/releases/latest/download/module.json"
Write-Host ""

# Argumentos como array: PowerShell no analiza bien --clave="valor" en linea.
$arguments = @($main, "--dataPath=$DataPath", "--port=$Port")
& node @arguments
