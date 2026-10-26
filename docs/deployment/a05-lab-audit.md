# A05 · Auditoría de los seis equipos del laboratorio

**Estado:** plantilla preparada; **sin datos**. Ningún valor de esta página se ha medido todavía. Debe completarla quien tenga acceso físico al laboratorio (responsable de coordinación: Ángel Patiño) y registrar la evidencia en la tarjeta A05. D31, D33, H66 e I76 dependen de estos datos.

## Cómo recoger los datos (en cada equipo, PowerShell como usuario del laboratorio)

```powershell
hostname
Get-ComputerInfo -Property OsName,OsVersion,OsBuildNumber,CsProcessors,CsTotalPhysicalMemory
Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.PrefixOrigin -ne 'WellKnown' } | Select-Object InterfaceAlias,IPAddress,PrefixLength
wsl --status
wsl -l -v
docker version --format '{{.Server.Version}}'
docker compose version
Get-NetFirewallProfile | Select-Object Name,Enabled
whoami /groups | findstr /i "Administrators docker-users"
```

Conectividad entre equipos (desde cada equipo hacia el que alojaría Go y el que alojaría PostgreSQL/Rust):

```powershell
Test-NetConnection <host> -Port 8080   # Go HTTP/WebSocket público
Test-NetConnection <host> -Port 4173   # cliente web (server.mjs), si se sirve desde otro equipo
Test-NetConnection <host> -Port 50051  # Envoy gRPC (solo si Go y Envoy quedan en equipos distintos)
Test-NetConnection <host> -Port 5432   # PostgreSQL (solo si queda en otro equipo)
```

Dentro de WSL2, comprobar que Docker funciona y que el stack arranca en ese equipo: `docker run --rm hello-world` y, si el equipo alojará servicios, `docker compose config` en un checkout limpio.

## Registro

| Equipo | Hostname confirmado | IPv4 confirmada | Windows 10 (edición/build) | CPU (núcleos/hilos) | RAM | WSL2 | Docker Engine / Compose | Permisos (admin, docker-users) | Firewall (perfiles) | Puertos abiertos verificados | Conectividad verificada con | Observaciones | Fecha y responsable |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | | | | | | |
| 2 | | | | | | | | | | | | | |
| 3 | | | | | | | | | | | | | |
| 4 | | | | | | | | | | | | | |
| 5 | | | | | | | | | | | | | |
| 6 | | | | | | | | | | | | | |

## Criterios para decidir la topología (D31)

- Go, Envoy y las dos Rust pueden compartir host; PostgreSQL necesita volumen persistente y no debe alojarse en un equipo que se reinicie entre sesiones.
- Si las dos Rust comparten host con Go, la demo de failover sigue siendo válida (caída de una réplica), pero no demuestra tolerancia a la caída de un equipo; debe declararse así.
- Tres equipos actúan como clientes (navegador y/o cliente Python). El cliente web desde otro equipo requiere HTTPS hasta Go (ver [H66](h66-deploy-procedure.md)); el cliente Python funciona sobre HTTP.
- Registrar límites de recursos medidos (RAM libre con el stack levantado) antes de repartir servicios.
