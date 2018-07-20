all: index.js

node_modules:
	npm install

%.js: %.ts node_modules
	tsc

clean:
	@rm *.js *.js.map || true

test:
	npm test

install:
	@true


.PHONY: clean test install

