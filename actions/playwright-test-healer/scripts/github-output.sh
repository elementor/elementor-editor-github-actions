# Sourced by the healer workflow's shell steps: the shell form of
# github-output.js. Every value is written in GITHUB_OUTPUT's delimited form
# with a random delimiter, so a newline in a test title or an API value stays
# part of that value instead of starting a forged `name=value` line.

set_output() {
	local name="$1"
	local value="$2"
	local delimiter
	delimiter="ghadelimiter_$(od -An -tx1 -N16 /dev/urandom | tr -d ' \n')"

	if [[ "$name" == *"$delimiter"* || "$value" == *"$delimiter"* ]]; then
		echo "::error::Output ${name} contains its own delimiter."
		return 1
	fi

	printf '%s<<%s\n%s\n%s\n' "$name" "$delimiter" "$value" "$delimiter" >> "$GITHUB_OUTPUT"
}
