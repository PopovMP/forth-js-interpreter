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
		console.log(`\x1b[31m\x1b[1m NOK - ${testName}: Expected ${expect}, but got: ${actual}\x1b[0m`)
	}
}

function testReady()
{
	if (totalTests === passedTests) {
		console.log(`\x1b[32m\x1b[1m Tests: ${totalTests}, passed: ${passedTests}, 100% \x1b[0m`)
	}
	else {
		console.log(`\x1b[31m\x1b[1m Tests: ${totalTests}, passed: ${passedTests}, failed: ${totalTests-passedTests} \x1b[0m`)
	}
}

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

(function () {
	interpret('." Hello, World!"')
	assert('Hello World', 1, 1)
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

(function () {
	// XT: nestRTS, NFA: unnestRTS
	interpret(`: colon-def-a ;  ' colon-def-a  DUP .  >BODY @ .`)
	assert('Empty colon-def', 1, 1)
})();

(function () {
	// PFA: cellRTS, PFA+8: 42
	interpret(`: colon-def-num 42 ; ' colon-def-num >BODY DUP @ .   8 + @ DUP .`)
	assert('Colon def with a num', 42, pop())
})();

(function () {
	interpret(`: colon-def-lbr [ 42 DUP . ] ; `)
	assert('Left bracket', 42, pop())
})();

(function () {
	interpret(`: colon-def-42 42 ;   colon-def-42    DUP .`   )
	assert('Set 42 in stack', 42, pop())
})();

(function () {
	interpret(`: colon-def-range 42 43 44 ;   colon-def-range`   )
	const range = [pop(), pop(), pop()].reverse().join(' ')
	assert('Range 42 43 44', '42 43 44', range)
})();

(function () {
	interpret(` 42 : colon-def-DUP DUP  ; colon-def-DUP .`   )
	assert('Colon-def DUP', 42, pop())
})();

(function () {
	interpret(` 20 22 : colon-def-+ + ;   colon-def-+   DUP .`   )
	assert('Colon-def DUP', 42, pop())
})();


testReady()
