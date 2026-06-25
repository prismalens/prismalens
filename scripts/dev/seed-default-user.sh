#!/bin/bash
# Creates default dev admin via setup API. Requires API running on port 3001.

STATUS=$(curl -s http://localhost:3001/api/setup/status)

if echo "$STATUS" | grep -q '"setupComplete":true'; then
	echo "Setup already complete — admin user exists. Run Dev: Reset Auth DB first."
else
	curl -s -X POST http://localhost:3001/api/setup \
		-H 'Content-Type: application/json' \
		-d '{"email":"admin@prismalens.dev","password":"admin123","name":"Admin"}' > /dev/null
	echo "Dev user created"
	echo "   Email:    admin@prismalens.dev"
	echo "   Password: admin123"
fi
