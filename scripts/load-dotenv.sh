#!/usr/bin/env bash
# Source a KEY=value file. Existing environment variables win.
# The file is not printed. Values may be single- or double-quoted.

load_dotenv() {
	local file="${1:-.env}"
	local line key value
	[[ -f "$file" ]] || return 0
	while IFS= read -r line || [[ -n "$line" ]]; do
		case "$line" in
			"" | \#*) continue ;;
		esac
		[[ "$line" == *"="* ]] || continue
		key="${line%%=*}"
		value="${line#*=}"
		key="${key#"${key%%[![:space:]]*}"}"
		key="${key%"${key##*[![:space:]]}"}"
		key="${key#export }"
		if [[ ${#value} -ge 2 && ${value:0:1} == "'" && ${value: -1} == "'" ]]; then
			value="${value:1:${#value}-2}"
		elif [[ ${#value} -ge 2 && ${value:0:1} == '"' && ${value: -1} == '"' ]]; then
			value="${value:1:${#value}-2}"
		fi
		if [[ -z "${!key:-}" ]]; then
			export "$key=$value"
		fi
	done <"$file"
}
