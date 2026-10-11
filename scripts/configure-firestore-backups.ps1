param(
  [string]$ProjectId = 'testing-c2bb7',
  [string]$Database = '(default)'
)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
  throw 'Google Cloud CLI is required. Install it, authenticate, and rerun this script.'
}
gcloud config set project $ProjectId | Out-Null
$existing = gcloud firestore backups schedules list --database=$Database --format=json | ConvertFrom-Json
if (-not ($existing | Where-Object { $_.dailyRecurrence })) {
  gcloud firestore backups schedules create --database=$Database --retention=14d --recurrence=daily
}
if (-not ($existing | Where-Object { $_.weeklyRecurrence })) {
  gcloud firestore backups schedules create --database=$Database --retention=14w --recurrence=weekly --day-of-week=SUN
}
gcloud firestore backups schedules list --database=$Database
