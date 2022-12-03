const process = require('node:process')
const {forth} = require('./forth.js')

function write(text)
{
	process.stdout.write(text, 'ascii')
}

const {interpret, pop} = forth(write)

let totalTests  = 0
let passedTests = 0

function assert(testName, expect, actual)
{
	totalTests += 1
	if (expect === actual) {
		passedTests += 1
		console.log(`\x1b[32m\x1b[1m OK - ${testName}\x1b[0m`)
	}
	else {
		console.log(`\x1b[31m\x1b[1m FAIL - ${testName}: Expected ${expect}, but got: ${actual}\x1b[0m`)
	}
}

function testReady()
{
	const color = totalTests === passedTests ? '\x1b[32m' : '\x1b[31m'
	console.log(`${color}\x1b[1m Tests: ${totalTests}, passed: ${passedTests}, failed: ${totalTests - passedTests} \x1b[0m`)
}


// Error cases

(function () {
	interpret('. Expected "Stack underflow"')
	assert('Stack underflow', 1, 1)
})();

(function () {
	interpret('foo Expected "foo ?"')
	assert('Unknown word', 1, 1)
})();

(function () {
	interpret(`' foo   Expected "foo ?"`)
	assert('Unknown word foo', 1, 1)
})();

// Strings

(function () {
	interpret('." Hello, World!"')
	assert('Interpretation ."', 1, 1)
})();

(function () {
	interpret('S" Hello, World!" SWAP DROP')
	assert('Interpretation S"', 13, pop())
})();

(function () {
	interpret('C" Hello, World!" C@ ')
	assert('Interpretation C"', 13, pop())
})();

// Stack operations

(function () {
	interpret(' 42 43 DEPTH DUP .')
	assert('DEPTH', 2, pop())
	pop()
	pop()
})();

(function () {
	interpret(' 1 ?DUP + DUP .')
	assert('1 ?DUP', 2, pop())
})();

(function () {
	interpret(' 0 ?DUP DEPTH  DUP .')
	assert('0 ?DUP', 1, pop())
	pop()
})();

(function () {
	interpret('CREATE foo   foo   HERE')
	const expect = pop()
	const actual = pop()
	assert('CREATE and HERE', expect, actual)
})();

(function () {
	interpret('CREATE foo   42 ,  foo @  DUP .')
	assert('CREATE store fetch val', 42, pop())
})();

(function () {
	interpret(`VARIABLE bar 10 CELLS ALLOT    42 bar 4 CELLS + !    bar 4 CELLS + @   DUP .`)
	assert('VARIABLE store fetch val', 42, pop())
})();

(function () {
	interpret(`CREATE CR0   HERE  dup .  ' CR0 >BODY  dup . `)
	const expect = pop()
	const actual = pop()
	assert('CREATE \' >BODY', expect, actual)
})();

(function () {
	interpret(`42 CONSTANT ca   ca VALUE va  13 VALUE vb   va TO vb   vb DUP .`)
	assert('CONSTANT VALUE TO', 42, pop())
})();

(function () {
	interpret(`VARIABLE v5   42 v5 !   v5 @  DUP .`)
	assert('VARIABLE ! @', 42, pop())
})();

(function () {
	interpret(`42 CONSTANT c6   ' c6 EXECUTE   DUP .`)
	assert('CONSTANT EXECUTE', 42, pop())
})();

(function () {
	interpret(`CREATE hw    13 C,   CHAR H C, CHAR e C, CHAR l C, CHAR l C, CHAR o C, CHAR , C, BL C,`)
	interpret(`CHAR W C, CHAR o C, CHAR r C, CHAR l C, CHAR d C, CHAR ! C,  CR  hw COUNT TYPE`)
	assert('Hello World by chars', 1, 1)
})();

// Colon def

(function () {
	// XT: nestRTS, NFA: unnestRTS
	interpret(`: colon-def-a ;  ' colon-def-a  DUP .  >BODY @ .`)
	assert('Empty colon-def', 1, 1)
})();

(function () {
	// PFA: literalRTS, PFA+8: 42
	interpret(`: colon-def-num 42 ; ' colon-def-num >BODY DUP @ .   8 + @ DUP .`)
	assert('Colon def with a num', 42, pop())
})();

(function () {
	interpret(` 42 : colon-def-native DUP ;   colon-def-native    DUP .`)
	assert('Colon-def native', 42, pop())
})();

(function () {
	interpret(`10 2   : colon-def-mt TUCK DUP + * + ;   colon-def-mt    DUP .  `)
	assert('Colon-def multiple native words', 42, pop())
})();

(function () {
	// R: push 42 on stack
	interpret(`: literal-rts 42 ;   literal-rts    DUP .`)
	assert('literal-rts', 42, pop())
})();

(function () {
	interpret(`: colon-def-range 42 43 44 ;   colon-def-range`)
	const range = [pop(), pop(), pop()].reverse().join(' ')
	assert('Range 42 43 44', '42 43 44', range)
})();

(function () {
	interpret(`: colon-def-lbr [ 42 DUP . ] ; `)
	assert('Left bracket', 42, pop())
})();

/*
// TODO Make separate memory area for strings

(function () {
	interpret(`: colon-def-S S" Hello, World!" ;   colon-def-S TYPE `)
	assert('Colon def S', 1, 1)
})();

(function () {
	interpret(`: colon-def-S S" Hello, World!" ;   colon-def-S TYPE `)
	assert('Colon def S', 1, 1)
})();

(function () {
	interpret(`: colon-def-C" C" Hello, World!" ;   colon-def-C" COUNT TYPE `)
	assert('Colon-def C"', 1, 1)
})();

(function () {
	interpret(`: colon-def-." ." Hello, World!" ; `)
	assert('Colon-def ."', 1, 1)
})();

*/
testReady()
