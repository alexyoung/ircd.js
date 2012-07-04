test:
	./node_modules/.bin/mocha --reporter list -c --ui exports test/*.test.js

.PHONY: test
