cd "d:\Project Files\SUBORBITAL\agcc\backend"

$env:AGCC_GRANITE_API_KEY="NRvwD3-Kw0fqNtljq4k_kcWzhQ0q6idzTTRqTcMJC8pq"
$env:AGCC_WEATHER_API_URL="https://api.open-meteo.com/v1/forecast"
$env:AGCC_SPACE_WEATHER_API_URL="https://services.swpc.noaa.gov/json/planetary_k_index_1m.json"
$env:AGCC_STATION_CATALOG_PATH="d:\Project Files\SUBORBITAL\agcc\data\catalogs\stations.hybrid.json"

.\venv\Scripts\python.exe -m uvicorn agcc.api.app:app --host 127.0.0.1 --port 8000
