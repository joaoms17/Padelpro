# Helpers for the Supabase Management API (sourced by supabase-deploy.yml).
# Needs SUPABASE_ACCESS_TOKEN and PROJECT_REF in the environment.

# api METHOD /path [json-body] → prints the response body. On HTTP >= 400 it
# prints the error body to stderr and fails (so callers may discard stdout).
api() {
  local method=$1 path=$2 body=${3:-} out
  local args=(-sS --fail-with-body -X "$method"
    "https://api.supabase.com/v1/projects/$PROJECT_REF$path"
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"
    -H "Content-Type: application/json")
  if [ -n "$body" ]; then
    out=$(printf '%s' "$body" | curl "${args[@]}" --data-binary @-) || {
      echo "::error::Management API $method $path falhou: $out" >&2
      return 1
    }
  else
    out=$(curl "${args[@]}") || {
      echo "::error::Management API $method $path falhou: $out" >&2
      return 1
    }
  fi
  printf '%s' "$out"
}

# sql "<statements>" → prints the rows of the last statement as a JSON array.
sql() {
  api POST "/database/query" "$(jq -n --arg q "$1" '{query: $q}')"
}
