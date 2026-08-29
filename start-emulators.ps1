# Script para iniciar Firebase emulators con Java y Node.js correctamente configurados

# Configura variables de entorno
$env:JAVA_HOME = "C:\Users\Luis\AppData\Local\Programs\Microsoft\jdk-21.0.12.101-hotspot"
$env:NODE_HOME = "C:\Program Files\nodejs"
$env:Path = "$env:Path;$env:JAVA_HOME\bin;$env:NODE_HOME;C:\Users\Luis\AppData\Roaming\npm"

# Verifica que Java esté disponible
Write-Host "Verificando Java..."
& "$env:JAVA_HOME\bin\java.exe" -version 2>&1

# Verifica que Node.js esté disponible
Write-Host "`nVerificando Node.js..."
& "$env:NODE_HOME\node.exe" -v

# Inicia Firebase emulators
Write-Host "`nIniciando Firebase emulators..."
& "$env:NODE_HOME\node.exe" "C:\Users\Luis\AppData\Roaming\npm\node_modules\firebase-tools\lib\bin\firebase.js" emulators:start
