'use strict'

/**
 * Forth interpreter
 * @param { (text: string) => void } write
 * @return {{ interpret(text: string): void, pop(): number }}
 */
function forth (write) {
	// Registers
	const STATE_ADDR              =     72
	const TO_IN_ADDR              =     80 // Addr of input buffer pointer
	const INPUT_BUFFER_CHARS_ADDR =     88
	const CURRENT_DEF_ADDR        =     96 // Name a-addr of the latest definition
	// Memory regions
	const INPUT_BUFFER_ADDR       =    120
	const INPUT_BUFFER_SIZE       =    256
	const DATA_STACK_ADDR         =    376 // size 32 cells
	const RET_STACK_ADDR          =    632 // size 1024 cells
	const POD_ADDR                =  8_824 // size 90 cells
	const PARSE_WORD_ADDR         =  9_544 // size 32 cells
	const NATIVE_XT_ADDR          =  9_800
	const DSP_START_ADDR          = 10_000
	const MEMORY_SIZE             = 64_000

	const Immediate = 1
	const Hidden    = 2

	const _buffer = new ArrayBuffer(MEMORY_SIZE)
	const _chars  = new Uint8Array(_buffer)
	const _cells  = new Float64Array(_buffer)

	/** @type { {[CFA: number]: (PFA: number) => void } */
	const _wordMap = {}

	/** @property {number} DS - data-space pointer */
	let DS = DSP_START_ADDR

	/** @property {number} S - data Stack pointer */
	let S = DATA_STACK_ADDR

	/** @property {number} R - Return stack pointer */
	let R = RET_STACK_ADDR

	// Declare native words
	addWords()

	/**
	 * Stores a f64 number to memory
	 * @param {number} x     - f64 value
	 * @param {number} aAddr - cell aligned address
	 * @return {void}
	 */
	function store(x, aAddr)
	{
		if (aAddr === CURRENT_DEF_ADDR && (x < DSP_START_ADDR || x > MEMORY_SIZE) && x !== 0)
			throw new Error('Wrong DSP_START_ADDR: ' + x)
		if (aAddr % 8 !== 0)
			throw new Error('Address is not aligned. Given: ' + aAddr)
		_cells[aAddr>>3] = x
	}

	/**
	 * Loads a f64 number from memory
	 * @param {number} aAddr - cell aligned address
	 * @return {number}
	 */
	function fetch(aAddr)
	{
		if (aAddr % 8 !== 0)
			throw new Error('Address is not aligned. Given: ' + aAddr)
		return _cells[aAddr>>3]
	}

	/**
	 * Stores an i8 char to memory
	 * @param {number} char  - i8 value
	 * @param {number} cAddr - character aligned address
	 * @return {void}
	 */
	function cStore(char, cAddr)
	{
		if (cAddr === CURRENT_DEF_ADDR)
			throw new Error('Invalid access to DSP_START_ADDR')
		_chars[cAddr] = char
	}

	/**
	 * Loads an i8 char from memory
	 * @param {number} cAddr - character aligned address
	 * @return {number}
	 */
	function cFetch(cAddr)
	{
		return _chars[cAddr]
	}

	/**
	 * Pushes a number to data stack.
	 * @param {number} x - f64 number
	 * @return {void}
	 */
	function push(x)
	{
		store(x, S)
		S += 8
	}

	/**
	 * Gets the top number of Data stack
	 * @return {number}
	 */
	function pop()
	{
		if (S === DATA_STACK_ADDR)
			throw new Error('Stack underflow')
		S -= 8
		return fetch(S)
	}

	/**
	 * Gets a number from the stack
	 * @param {number} i
	 * @return {number}
	 */
	function pick(i)
	{
		const ptr = S - 8 - (i<<3)
		if (ptr < DATA_STACK_ADDR)
			throw new Error('Stack underflow')
		return fetch(ptr)
	}

	/**
	 * Gets the stack depth
	 * @return {number}
	 */
	function depth()
	{
		return ((S - DSP_START_ADDR) >> 3)
	}

	/**
	 * Empties stack
	 * @return {void}
	 */
	function empty()
	{
		S = DATA_STACK_ADDR
	}

	/**
	 * Pushes a number to return stack.
	 * @param {number} x
	 * @return {void}
	 */
	function rPush(x)
	{
		store(x, R)
		R += 8
	}

	/**
	 * Gets the top number of return stack
	 * @return {number}
	 */
	function rPop()
	{
		if (R === RET_STACK_ADDR)
			throw new Error('Stack underflow')
		R -= 8
		return fetch(R)
	}

	/**
	 * Gets a number from the return stack
	 * @param {number} i
	 * @return {number}
	 */
	function rPick(i)
	{
		const ptr = R - 8 - (i<<3)
		if (ptr < RET_STACK_ADDR)
			throw new Error('Stack underflow')
		return fetch(ptr)
	}

	/**
	 * Empties return stack
	 * @return {void}
	 */
	function rEmpty()
	{
		R = RET_STACK_ADDR
	}

	/**
	 * Adds a native word record to the map
	 * @param {string} word
	 * @param {(PFA: number) => void} action
	 * @param {number} flags
	 */
	function addWord(word, action, flags)
	{
		ALIGN()
		HERE()
		const wordNFA = pop()
		push(48)
		ALLOT()

		// addr+0 - name length
		cStore(word.length, wordNFA)

		// addr+1 - name char codes
		const len = Math.min(word.length, 30)
		let index = 0
		while (index < len) {
			cStore(word.charCodeAt(index), wordNFA + index + 1)
			index += 1
		}

		// addr+31 - status flags
		cStore(flags, wordNFA+31)

		// addr+32 - link to previous definition
		const currentNFA = fetch(CURRENT_DEF_ADDR)
		store(currentNFA, wordNFA+32)
		store(wordNFA, CURRENT_DEF_ADDR)

		// addr+40 - CFA - Code Field Address
		const rts = NATIVE_XT_ADDR + Object.keys(_wordMap).length
		const pfa = wordNFA+48
		const xt  = 100_000 * pfa + rts
		store(xt, wordNFA+40)
		_wordMap[rts] = action.bind(this)

		// addr+48 - PFA - Parameters Filed Address
		store(0, wordNFA+48)
	}

	/**
	 * Interprets forth code.
	 * Shows output via `write` and exposes data via `pop`
	 * @param {string} text - max 254 chars length
	 */
	function interpret(text)
	{
		const srcCode = text.slice(0, INPUT_BUFFER_SIZE - 2) + ' '
		let index = 0

		// Copy source code
		while (index < srcCode.length) {
			const char = srcCode.charCodeAt(index)
			cStore(char, INPUT_BUFFER_ADDR + index)
			index += 1
		}

		// Wipe rest of the buffer
		while (index < INPUT_BUFFER_SIZE) {
			cStore(32, INPUT_BUFFER_ADDR + index)
			index += 1
		}

		store(0, TO_IN_ADDR)
		store(srcCode.length, INPUT_BUFFER_CHARS_ADDR)

		runInterpreter()
	}

	function runInterpreter()
	{
		// print input buffer
		SOURCE()
		TYPE()

		while (true) {
			const isCompiling = fetch(STATE_ADDR) !== 0

			PARSE_NAME() // ( -- c-addr u)

			DUP()
			const nameLen = pop()
			if (nameLen === 0) {
				DROP()
				DROP()
				// No more words
				SPACE()
				typeText('ok')
				CR()
				break
			}

			POD()
			TO_UPPERCASE() // ( c-addr1 u c-addr2 -- c-addr2 )
			FIND()         // ( c-addr -- c-addr|cfa-addr flag )

			const flag = pop()
			if (flag !== 0) {
				// Word found
				try {
					if (!isCompiling || (isCompiling && flag === 1) )
						EXECUTE() // Interpret state or Immediate
					else
						COMPILE_COMMA()
				}
				catch (e) {
					abort(e.message)
					break
				}
			}
			else {
				// Word not found. Try number
				DROP()
				push(0)
				POD()
				COUNT()
				TO_NUMBER() // ( n1 c-addr1 u1 -– n2 c-addr2 u2 )
				const remLen = pop()
				DROP()
				if (remLen !== 0) {
					// Unknown word
					DROP()
					abort('?')
					break
				}
				if (isCompiling) {
					const num = pop()
					HERE()
					const addr = pop()
					push(100_000*(addr+8) + NATIVE_XT_ADDR+6) // cellRTS
					COMMA()
					push(num)
					COMMA()
				}
			}
		}
	}

	/**
	 * Show the parsed word, the message and abort
	 * @param {string} message
	 */
	function abort(message)
	{
		ABORT()
		typeParsedWord()
		SPACE()
		typeText(message)
		CR()
	}

	/**
	 * Types text
	 * @param {string} text
	 * @return {void}
	 */
	function typeText(text)
	{
		const len = text.length
		POD()
		const cAddr = pop()
		cStore(len, cAddr)
		let index = 0
		while (index < len) {
			const char = text.charCodeAt(index)
			cStore(char, cAddr + 1 + index)
			index += 1
		}
		push(cAddr)
		COUNT()
		TYPE()
	}

	/**
	 * Types word from the PARSED_WORD buffer
	 */
	function typeParsedWord()
	{
		push(PARSE_WORD_ADDR)
		COUNT()
		TYPE()
	}

	function addWords()
	{
		addWord('',           variableRTS,   0|Hidden) // NATIVE_XT_ADDR + 0
		addWord('',           constantRTS,   0|Hidden) // NATIVE_XT_ADDR + 1
		addWord('',           valueRTS,      0|Hidden) // NATIVE_XT_ADDR + 2
		addWord('',           nestRTS,       0|Hidden) // NATIVE_XT_ADDR + 3
		addWord('',           unNestRTS,     0|Hidden) // NATIVE_XT_ADDR + 4
		addWord('',           nextRTS,       0|Hidden) // NATIVE_XT_ADDR + 5
		addWord('',           cellRTS,       0|Hidden) // NATIVE_XT_ADDR + 6
		addWord('+',          SUM,           0)
		addWord('-',          MINUS,         0)
		addWord('=',          EQUALS,        0)
		addWord('0=',         ZERO_EQUALS,   0)
		addWord('TRUE',       TRUE,          0)
		addWord('FALSE',      FALSE,         0)
		addWord('DROP',       DROP,          0)
		addWord('DUP',        DUP,           0)
		addWord('?DUP',       QUESTION_DUP,  0)
		addWord('PICK',       PICK,          0)
		addWord('OVER',       OVER,          0)
		addWord('SWAP',       SWAP,          0)
		addWord('NIP',        NIP,           0)
		addWord('ROT',        ROT,           0)
		addWord('TUCK',       TUCK,          0)
		addWord('DEPTH',      DEPTH,         0)
		addWord('R>',         R_FROM,        0)
		addWord('>R',         TO_R,          0)
		addWord('R@',         R_FETCH,       0)
		addWord('HERE',       HERE,          0)
		addWord('POD',        POD,           0)
		addWord('CREATE',     CREATE,        0)
		addWord('VARIABLE',   VARIABLE,      0)
		addWord('CONSTANT',   CONSTANT,      0)
		addWord('VALUE',      VALUE,         0)
		addWord('TO',         TO,            0)
		addWord('CHARS',      CHARS,         0)
		addWord('CELLS',      CELLS,         0)
		addWord('ALIGNED',    ALIGNED,       0)
		addWord('ALIGN',      ALIGN,         0)
		addWord('ALLOT',      ALLOT,         0)
		addWord(',',          COMMA,         0)
		addWord('@',          FETCH,         0)
		addWord('!',          STORE,         0)
		addWord('C,',         C_COMMA,       0)
		addWord('C@',         C_FETCH,       0)
		addWord('C!',         C_STORE,       0)
		addWord('COUNT',      COUNT,         0)
		addWord('EMIT',       EMIT,          0)
		addWord('TYPE',       TYPE,          0)
		addWord('>IN',        TO_IN,         0)
		addWord('SOURCE',     SOURCE,        0)
		addWord('PARSE',      PARSE,         0)
		addWord('PARSE-NAME', PARSE_NAME,    0)
		addWord('WORD',       WORD,          0)
		addWord('S"',         S_QUOTE,       0|Immediate)
		addWord('C"',         C_QUOTE,       0|Immediate)
		addWord('."',         DOT_QUOTE,     0|Immediate)
		addWord('COMPARE',    COMPARE,       0)
		addWord('FIND',       FIND,          0)
		addWord('CMOVE',      C_MOVE,        0)
		addWord('>NUMBER',    TO_NUMBER,     0)
		addWord('>UPPERCASE', TO_UPPERCASE,  0)
		addWord('\'',         TICK,          0)
		addWord('EXECUTE',    EXECUTE,       0)
		addWord('COMPILE,',   COMPILE_COMMA, 0)
		addWord('EVALUATE',   EVALUATE,      0)
		addWord('>BODY',      TO_BODY,       0)
		addWord('CHAR',       CHAR,          0)
		addWord('BL',         BL,            0)
		addWord('CR',         CR,            0)
		addWord('.',          DOT,           0)
		addWord('.S',         DOT_S,         0)
		addWord('SPACE',      SPACE,         0)
		addWord('ABORT',      ABORT,         0)
		addWord('QUIT',       QUIT,          0)
		addWord('STATE',      STATE,         0)
		addWord(']',          RIGHT_BRACKET, 0)
		addWord('[',          LEFT_BRACKET,  0|Immediate)
		addWord(':',          COLON,         0|Immediate)
		addWord(';',          SEMICOLON,     0|Immediate)
		addWord('IMMEDIATE',  IMMEDIATE,     0)
	}

	// -------------------------------------
	// Run-time specifics
	// -------------------------------------

	/**
	 * Run-time specifics for CREATE and VARIABLE
	 * @param {number} pfa - parameter-field address
	 * @return {void}
	 */
	function variableRTS(pfa) { push(pfa) }

	/**
	 * Run-time specifics for CONSTANT
	 * @param {number} pfa - parameter-field address
	 * @return {void}
	 */
	function constantRTS(pfa) { push( fetch(pfa) ) }

	/**
	 * Run-time specifics for VALUE
	 * @param {number} pfa - parameter-field address
	 * @return {void}
	 */
	function valueRTS(pfa) { push( fetch(pfa) ) }

	/**
	 * Run-time specifics for colon-def
	 * @param {number} pfa - parameter-field address
	 * @return {void}
	 */
	function nestRTS(pfa)
	{
		const val = fetch(pfa)
		push(val)
		DUP()
		TO_R()
		EXECUTE() // Execute first XT of the colon-def
	}

	/**
	 * Run-time specifics for colon-def
	 * @param {number} pfa - parameter-field address
	 * @return {void}
	 */
	function unNestRTS(pfa)
	{
		R_FROM()
		DROP()
	}

	/**
	 * Run-time specifics for colon-def
	 * @param {number} pfa - parameter-field address
	 * @return {void}
	 */
	function nextRTS(pfa)
	{
		const val = fetch(pfa)
		push(val)
	}

	/**
	 * Run-time specifics for literal number in a colon-def
	 * The number is in the next cell
	 * @param {number} addr - address of the number.
	 * @return {void}
	 */
	function cellRTS(addr)
	{
		const val = fetch(addr)
		push(val)

		// Execute next XT
		const nextXT = fetch(addr+8)
		push(nextXT)
		EXECUTE()
	}

	// -------------------------------------
	// Numbers
	// ------------------------------------

	/**
	 * + ( n1 | u1 n2 | u2 -- n3 | u3 )
	 * Add n2 | u2 to n1 | u1, giving the sum n3 | u3.
	 */
	function SUM()
	{
		const n2 = pop()
		const n1 = pop()
		push(n1 + n2)
	}

	/**
	 * - ( n1 | u1 n2 | u2 -- n3 | u3 )
	 * Subtract n2 | u2 from n1 | u1, giving the difference n3 | u3.
	 */
	function MINUS()
	{
		const n2 = pop()
		const n1 = pop()
		push(n1 - n2)
	}

	/**
	 * = ( x1 x2 -- flag )
	 * flag is true if and only if x1 is bit-for-bit the same as x2.
	 */
	function EQUALS()
	{
		const n2 = pop()
		const n1 = pop()
		push(n1 === n2 ? -1 : 0)
	}

	/**
	 * 0= ( x -- flag )
	 * flag is true if and only if x is equal to zero.
	 */
	function ZERO_EQUALS()
	{
		const n1 = pop()
		push(n1 === 0 ? -1 : 0)
	}

	/**
	 * TRUE ( -- true )
	 * Return a true flag, a single-cell value with all bits set.
	 */
	function TRUE() { push(-1) }

	/**
	 * FALSE ( -- false )
	 * Return a false flag, a single-cell value with all bits unset.
	 */
	function FALSE() { push(0) }

	// -------------------------------------
	// Stack Operations
	// ------------------------------------

	/**
	 * DROP ( x -- )
	 * Remove x from the stack.
	 */
	function DROP()	{ pop() }

	/**
	 * DUP ( x -- x x )
	 * Duplicate x.
	 */
	function DUP() { push( pick(0) ) }

	/**
	 * ?DUP ( x -- 0 | x x )
	 * Duplicate x if it is non-zero.
	 */
	function QUESTION_DUP()
	{
		const x = pick(0)
		if (x !== 0)
			push(x)
	}

	/**
	 * PICK ( xu...x1 x0 u -- xu...x1 x0 xu )
	 * Remove u. Copy the xu to the top of the stack.
	 */
	function PICK()
	{
		const u = pop()
		const x = pick(u)
		push(x)
	}

	/**
	 * OVER ( x1 x2 -- x1 x2 x1 )
	 * Place a copy of x1 on top of the stack.
	 */
	function OVER() { push( pick(1) ) }

	/**
	 * SWAP ( x1 x2 -- x2 x1 )
	 * Exchange the top two stack items.
	 */
	function SWAP()
	{
		const x2 = pop()
		const x1 = pop()
		push(x2)
		push(x1)
	}

	/**
	 * NIP ( x1 x2 -- x2 )
	 * Drop the first item below the top of stack.
	 */
	function NIP()
	{
		const x2 = pop()
		pop()
		push(x2)
	}

	/**
	 * ROT ( x1 x2 x3 -- x2 x3 x1 )
	 * Rotate the top three stack entries.
	 */
	function ROT()
	{
		const x3 = pop()
		const x2 = pop()
		const x1 = pop()
		push(x2)
		push(x3)
		push(x1)
	}

	/**
	 * TUCK ( x1 x2 -- x2 x1 x2 )
	 * Copy the first (top) stack item below the second stack item.
	 */
	function TUCK()
	{
		const x2 = pop()
		const x1 = pop()
		push(x2)
		push(x1)
		push(x2)
	}

	/**
	 * DEPTH ( -- +n )
	 * +n is the number of single-cell values contained in the data stack
	 * before +n was placed on the stack.
	 */
	function DEPTH()
	{
		const n = depth()
		push(n)
	}

	// -------------------------------------
	// Return Stack Operations
	// ------------------------------------

	/**
	 * >R ( x -- ) ( R: -- x )
	 * Move x to the return stack.
	 */
	function TO_R()
	{
		const x = pop()
		rPush(x)
	}

	/**
	 * R> ( -- x ) ( R: x -- )
	 * Move x from the return stack to the data stack.
	 */
	function R_FROM()
	{
		const x = rPop()
		push(x)
	}

	/**
	 * R@ ( -- x ) ( R: x -- x )
	 * Copy x from the return stack to the data stack.
	 */
	function R_FETCH()
	{
		const x = rPick(0)
		push(x)
	}

	/**
	 * CHARS ( n1 -- n2 )
	 * n2 is the size in address units of n1 characters.
	 */
	function CHARS() { } // Char is 1

	/**
	 * CELLS ( n1 -- n2 )
	 * n2 is the size in address units of n1 cells.
	 */
	function CELLS()
	{
		const n1 = pop()
		push(n1 * 8)
	}

	// -------------------------------------
	// Memory Operations
	// ------------------------------------

	/**
	 * HERE ( -- addr )
	 * Pushes the data-space pointer to the stack.
	 */
	function HERE() { push(DS) }

	/**
	 * ALIGNED ( addr -- a-addr )
	 * a-addr is the first aligned address greater than or equal to addr.
	 */
	function ALIGNED()
	{
		const addr  = pop()
		const rem   = addr % 8
		const delta = rem === 0 ? 0 : 8 - rem
		push(addr + delta)
	}

	/**
	 * ALIGN ( -- )
	 * Aligns the data-space pointer
	 */
	function ALIGN()
	{
		HERE()
		DUP()
		ALIGNED()
		SWAP()
		MINUS()
		ALLOT()
	}

	/**
	 * ! ( x a-addr -- )
	 * Store x at a-addr.
	 */
	function STORE()
	{
		const aAddr = pop()
		const x     = pop()
		store(x, aAddr)
	}

	/**
	 * @ ( a-addr -- x )
	 * x is the value stored at a-addr.
	 */
	function FETCH()
	{
		const aAddr = pop()
		const x     = fetch(aAddr)
		push(x)
	}

	/**
	 * C! ( char c-addr -- )
	 * Store char at c-addr.
	 */
	function C_STORE()
	{
		const cAddr = pop()
		const char  = pop()
		cStore(char, cAddr)
	}

	/**
	 * C@ ( c-addr -- char  )
	 * Fetch the character stored at c-addr.
	 */
	function C_FETCH()
	{
		const cAddr = pop()
		const char  = cFetch(cAddr)
		push(char)
	}

	/**
	 * ALLOT ( n -- )
	 * If n is greater than zero, reserve n address units of data space.
	 */
	function ALLOT()
	{
		const n = pop()
		DS += n
	}

	/**
	 * , ( x -- )
	 * Reserve one cell of data space and store x in the cell.
	 */
	function COMMA()
	{
		ALIGN()
		HERE()
		STORE()
		push(8)
		ALLOT()
	}

	/**
	 * C, ( char -- )
	 * Reserve space for one character in the data space and store char in the space.
	 */
	function C_COMMA()
	{
		HERE()
		C_STORE()
		push(1)
		ALLOT()
	}

	/**
	 * POD ( -- addr )
	 * A temporary memory filed
	 */
	function POD() { push(POD_ADDR) }

	/**
	 * CREATE ( "<spaces>name" -- )
	 * Skip leading space delimiters. Parse name delimited by a space.
	 * Create a definition for name with the execution semantics defined below.
	 * If the data-space pointer is not aligned, reserve enough data space to align it.
	 * The new data-space pointer defines name's data field.
	 */
	function CREATE()
	{
		PARSE_NAME()
		const nameLen  = pop()
		const nameAddr = pop()
		if (nameLen === 0)
			throw new Error('Empty name')

		ALIGN()
		HERE()
		const nfa = pop()
		push(48)
		ALLOT()

		// addr+0 - name length
		// addr+1 - name char codes
		push(nameAddr)
		push(nameLen)
		push(nfa)
		TO_UPPERCASE()
		DROP()

		// addr+31 - status flags
		cStore(0, nfa+31)

		// addr+32 - link to previous definition
		const currentNFA = fetch(CURRENT_DEF_ADDR)
		store(currentNFA, nfa+32)
		store(nfa, CURRENT_DEF_ADDR)

		// addr+40 - CFA - Code Field Address
		const xt = 100_000*(nfa+48) + NATIVE_XT_ADDR // varRTS
		store(xt, nfa+40)
	}

	/**
	 * VARIABLE ( "<spaces>name" -- )
	 * Skip leading space delimiters. Parse name delimited by a space.
	 * Create a definition for name with the execution semantics defined below.
	 * Reserve one cell of data space at an aligned address.
	 */
	function VARIABLE()
	{
		CREATE()
		push(0)
		COMMA()
	}

	/**
	 * CONSTANT ( x "<spaces>name" -- )  name ( -- x )
	 * Skip leading space delimiters. Parse name delimited by a space.
	 * Create a definition for name with the execution semantics defined below.
	 * name is referred to as a "constant".
	 */
	function CONSTANT()
	{
		const x = pop()
		CREATE()

		// Set XT for CONSTANT
		HERE()
		const pfa = pop()
		const xt  = 100_000*pfa + NATIVE_XT_ADDR+1
		store(xt, pfa - 8)

		push(x)
		COMMA()
	}

	/**
	 * VALUE ( x "<spaces>name" -- )  name ( -- x )
	 * Skip leading space delimiters. Parse name delimited by a space.
	 * Create a definition for name with the execution semantics defined below,
	 * with an initial value equal to x.
	 * name is referred to as a "value".
	 */
	function VALUE()
	{
		const x = pop()
		CREATE()

		// Set XT for VALUE
		HERE()
		const pfa = pop()
		const xt  = 100_000*pfa + NATIVE_XT_ADDR+2
		store(xt, pfa - 8)

		push(x)
		COMMA()
	}

	/**
	 * TO ( i * x "<spaces>name" -- )
	 * Skip leading spaces and parse name delimited by a space.
	 * Perform the "TO name run-time" semantics given in the definition for the defining word of name.
	 */
	function TO()
	{
		const n = pop()
		TICK()
		const xt  = pop()
		const pfa = Math.floor(xt / 100_000)
		store(n, pfa)
	}

	// -------------------------------------
	// Parsing
	// ------------------------------------

	/**
	 * COUNT ( c-addr1 -- c-addr2 u )
	 * Return the character string specification for the counted string stored at c-addr1.
	 * c-addr2 is the address of the first character after c-addr1.
	 * u is the contents of the character at c-addr1,
	 * which is the length in characters of the string at c-addr2.
	 */
	function COUNT()
	{
		const cAddr1 = pop()
		const length = cFetch(cAddr1)
		push(cAddr1+1)
		push(length)
	}

	/**
	 * EMIT ( x -- )
	 * If x is a graphic character in the implementation-defined character set, display x.
	 */
	function EMIT()
	{
		const char = pop()
		const text = 31 < char && char < 127 ? String.fromCharCode(char) : '?'
		write(text)
	}

	/**
	 * ( c-addr u -- )
	 * If u is greater than zero, display the character string specified by c-addr and u.
	 */
	function TYPE()
	{
		const length = pop()
		const cAddr  = pop()

		let index = 0
		while (index < length) {
			const char = cFetch(cAddr + index)
			push(char)
			EMIT()
			index += 1
		}
	}

	/**
	 * >IN ( -- a-addr )
	 * a-addr is the address of a cell containing the offset in characters
	 * from the start of the input buffer to the start of the parse area.
	 */
	function TO_IN() { push(TO_IN_ADDR) }

	/**
	 * SOURCE ( -- c-addr u )
	 * c-addr is the address of, and u is the number of characters in, the input buffer.
	 */
	function SOURCE()
	{
		push(INPUT_BUFFER_ADDR)
		const numChars = fetch(INPUT_BUFFER_CHARS_ADDR)
		push(numChars)
	}

	/**
	 * PARSE ( char "ccc<char>" -- c-addr u )
	 * Parse ccc delimited by the delimiter char.
	 * c-addr is the address (within the input buffer) and u is the length of the parsed string.
	 * If the parse area was empty, the resulting string has a zero length.
	 */
	function PARSE()
	{
		const delimiter = pop()

		SOURCE()
		const maxSize = pop() // Count of chars in the Input buffer
		const cAddr   = pop() // Addr of Input buffer

		const startIndex = fetch(TO_IN_ADDR)

		let index = startIndex
		while (index < maxSize) {
			const char = cFetch(cAddr + index)
			if (char === delimiter) break
			index += 1
		}

		store(index+1, TO_IN_ADDR) // Move >IN after the closing delimiter
		push(cAddr + startIndex)   // Name cAddr
		push(index - startIndex)   // Name length
	}

	/**
	 * PARSE-NAME ( "<spaces>name<space>" -- c-addr u )
	 * Skip leading space delimiters. Parse name delimited by a space.
	 * c-addr is the address of the selected string within the input buffer and u is its length in characters.
	 * If the parse area is empty or contains only white space, the resulting string has length zero.
	 */
	function PARSE_NAME()
	{
		SOURCE()
		const inBuffSize = pop() // Count of chars in the Input buffer
		const inBuffAddr = pop() // Addr of Input buffer
		const startIndex = fetch(TO_IN_ADDR)

		let nameLen  = 0
		let nameAddr = 0
		let index    = startIndex
		while (index < inBuffSize) {
			const char = cFetch(inBuffAddr + index)
			if (char === 32) {
				if (nameLen === 0) {
					// Skip leading spaces
					index += 1
					continue
				}

				// Delimiter found. Terminate parsing
				store(index + 1, TO_IN_ADDR)
				break
			}
			if (nameAddr === 0)
				nameAddr = inBuffAddr + index
			nameLen += 1
			index   += 1
		}

		// Copy to parsed word
		cStore(nameLen, PARSE_WORD_ADDR)
		push(nameAddr)
		push(PARSE_WORD_ADDR + 1)
		push(nameLen)
		C_MOVE()

		// Push output
		push(nameAddr)
		push(nameLen)
	}

	/**
	 * WORD ( char "<chars>ccc<char>" -- c-addr )
	 * Skip leading delimiters. Parse characters ccc delimited by char.
	 */
	function WORD()
	{
		const delimiter = pop()

		SOURCE()
		const inBuffSize = pop() // Count of chars in the Input buffer
		const inBuffAddr = pop() // Addr of Input buffer

		const startIndex = fetch(TO_IN_ADDR)

		POD()
		const wordAddr = pop()

		let wordLen = 0
		let i = startIndex
		while (i < inBuffSize) {
			const char = cFetch(inBuffAddr + i)
			if (char === delimiter) {
				if (wordLen === 0) {
					i += 1
					continue
				}
				store(i + 1, TO_IN_ADDR)
				break
			}
			cStore(char, wordAddr + 1 + wordLen)
			wordLen += 1
			i += 1
		}

		// Copy to parsed word
		cStore(wordLen, PARSE_WORD_ADDR)
		push(wordAddr)
		push(PARSE_WORD_ADDR + 1)
		push(wordLen)
		C_MOVE()

		// Output
		cStore(wordLen, wordAddr)
		push(wordAddr)
	}

	/**
	 * C" ( -- c-addr ) ( C: "ccc<quote>" -- )
	 * Parse ccc delimited by " (double-quote).
	 * Return c-addr, a counted string consisting of the characters ccc.
	 */
	function C_QUOTE()
	{
		const comma = '"'.charCodeAt(0)
		push(comma)
		PARSE()

		const len   = pop()
		const cAddr = pop()

		ALIGN()
		HERE()
		const defNFA = pop()
		push(len+2)
		ALLOT()

		cStore(0, defNFA)
		cStore(len, defNFA+1)
		let index = 0
		while (index < len) {
			const char = cFetch(cAddr + index)
			cStore(char, defNFA + 2 + index)
			index += 1
		}

		push(defNFA+1)
	}

	/**
	 * S" ( -- c-addr u ) ( C: "ccc<quote>" -- )
	 * Parse ccc delimited by " (double-quote).
	 * Return c-addr and u describing a string consisting of the characters ccc.
	 */
	function S_QUOTE()
	{
		C_QUOTE()
		COUNT()
	}

	/**
	 * ." ( -- ) ( C: "ccc<quote>" -- )
	 * Parse ccc delimited by " (double-quote).
	 * Append the run-time semantics: Display ccc.
	 */
	function DOT_QUOTE()
	{
		C_QUOTE()
		COUNT()
		TYPE()
	}

	/**
	 * COMPARE ( c-addr1 u1 c-addr2 u2 -- n )
	 * Compare the string specified by c-addr1 u1 to the string specified by c-addr2 u2.
	 */
	function COMPARE()
	{
		const len2   = pop()
		const cAddr2 = pop()
		const len1   = pop()
		const cAddr1 = pop()

		let charCmp = 0
		let i = 0
		while (i < Math.min(len1, len2)) {
			const char1 = cFetch(cAddr1 + i)
			const char2 = cFetch(cAddr2 + i)
			if (char1 !== char2) {
				charCmp = char1 < char2 ? -1 : 1
				break
			}
			i += 1
		}

		if (charCmp === 0) {
			if (len1 === len2)
				push(0)
			else
				push(len1 < len2 ? -1 : 1)
		}
		else {
			push(charCmp)
		}
	}

	/**
	 * FIND ( c-addr -- c-addr 0 | xt 1 | xt -1 )
	 * Find the definition named in the counted string at c-addr.
	 * If the definition is not found, return c-addr and zero.
	 * If the definition is found, return its execution token xt.
	 * If the definition is immediate, also return one (1),
	 * otherwise also return minus-one (-1).
	 */
	function FIND()
	{
		COUNT()
		const nameLen  = pop()
		const nameAddr = pop()

		let currNFA = fetch(CURRENT_DEF_ADDR)
		while (currNFA > 0) {
			const lengthMatch = cFetch(currNFA) === nameLen
			const isHidden    = cFetch(currNFA+31) & Hidden

			if (lengthMatch && !isHidden) {
				let found = true

				// Compare names characters
				let i = 0
				while (i < nameLen) {
					const currChar = cFetch(currNFA + 1 + i)
					const nameChar = cFetch(nameAddr + i)
					if (currChar !== nameChar) {
						found = false
						break
					}
					i += 1
				}

				if (found) {
					const xt = fetch(currNFA+40)
					push(xt)

					const immediate = cFetch(currNFA+31) & Immediate
					push(immediate ? 1 : -1)
					return
				}
			}

			currNFA = fetch(currNFA+32) // Previous def link
		}

		// Not found
		push(nameAddr-1)
		push(0)
	}

	/**
	 * CMOVE ( c-addr1 c-addr2 u -- )
	 * If u is greater than zero, copy u consecutive characters from the data space
	 * starting at c-addr1 to that starting at c-addr2,
	 * proceeding character-by-character from lower addresses to higher addresses.
	 */
	function C_MOVE()
	{
		const len      = pop()
		const toAddr   = pop()
		const fromAddr = pop()

		let index = 0
		while (index < len) {
			const char = cFetch(fromAddr + index)
			cStore(char, toAddr + index)
			index += 1
		}
	}

	/**
	 * >NUMBER ( n1 c-addr1 u1 -- n2 c-addr2 u2 )
	 */
	function TO_NUMBER()
	{
		const len   = pop()
		const cAddr = pop()
		pop()

		let i      = 0
		let res    = 0
		let sign   = 1
		let factor = 0
		while (i < len) {
			const charCode = cFetch(cAddr + i)
			if (i === 0) {
				if (charCode === '-'.charCodeAt(0)) {
					sign    = -1
					i      += 1
					factor += 1
					continue
				}
				if (charCode === '+'.charCodeAt(0)) {
					i      += 1
					factor += 1
					continue
				}
			}

			if (47 < charCode && charCode < 58) {
				factor += 1
				res += (charCode - 48) * (10 ** (len - factor))
			}
			else {
				// Not  a number
				push(0)
				push(cAddr + i)
				push(len - i)
				return
			}

			i += 1
		}

		// Number
		const num = res * sign
		push(num)
		push(cAddr + i)
		push(0)
	}

	/**
	 * >UPPERCASE ( c-addr1 u c-addr2 -- c-addr2)
	 * Converts a string to uppercase.
	 * The resulting string is placed at c-addr2. Non-standard.
	 */
	function TO_UPPERCASE()
	{
		const toAddr   = pop()
		const length   = pop()
		const fromAddr = pop()

		// Save the string length in the first char cell
		cStore(length, toAddr)

		let index = 0
		while (index < length) {
			let charCode = cFetch(fromAddr + index)
			if (96 < charCode && charCode < 123)
				charCode -= 32 // If lowercase, made it uppercase
			cStore(charCode, toAddr + index + 1)
			index += 1
		}

		push(toAddr)
	}

	/**
	 * ' ( "<spaces>name" -- xt )
	 * Skip leading space delimiters. Parse name delimited by a space.
	 * Find name and return xt, the execution token for name.
	 */
	function TICK()
	{
		PARSE_NAME()
		POD()
		TO_UPPERCASE() // (c-addr1 u c-addr2 -- c-addr2)
		FIND()
		const flag = pop()
		if (flag === 0)
			throw new Error('?')
	}

	/**
	 * EXECUTE ( i*x xt -- j*x )
	 * Remove xt from the stack and perform the semantics identified by it.
	 * Other stack effects are due to the word execution.
	 */
	function EXECUTE()
	{
		const xt  = pop()
		const rts = xt % 10_000
		const pfa = Math.floor(xt / 100_000)
		if (NATIVE_XT_ADDR <= rts && rts < DSP_START_ADDR)
			_wordMap[rts](pfa) // Gives the PFA - parameters-field address
		else
			throw new Error('Not an executable')
	}

	/**
	 * COMPILE, (E: xt -- )
	 * Append the execution semantics of the definition represented by xt
	 * to the execution semantics of the current definition.
	 */
	function COMPILE_COMMA()
	{
		COMMA() // Store xt in the current colon-def
		HERE()
		const addr = pop()
		push(100_000*addr + NATIVE_XT_ADDR+5) // nextRTS
		COMMA()
	}

	/**
	 * EVALUATE ( i * x c-addr u -- j * x )
	 * Save the current input source specification.
	 * Store minus-one (-1) in SOURCE-ID if it is present.
	 * Make the string described by c-addr and u both the input source and input buffer,
	 * set >IN to zero, and interpret. When the parse area is empty,
	 * restore the prior input source specification.
	 */
	function EVALUATE()
	{
		throw new Error('Not implemented')
	}

	/**
	 * >BODY ( xt-add - a-addr )
	 * a-addr is the data-field address corresponding to xt.
	 * An ambiguous condition exists if xt is not for a word defined via CREATE.
	 */
	function TO_BODY()
	{
		const xt  = pop()
		const pfa = Math.floor(xt / 100_000)
		push(pfa)
	}

	/**
	 * CHAR ( "<spaces>name" -- char )
	 * Skip leading space delimiters.
	 * Parse name delimited by a space.
	 * Put the value of its first character onto the stack.
	 */
	function CHAR()
	{
		BL()
		WORD()
		const cAddr = pop()
		const char  = cFetch(cAddr+1) // Skip the length byte
		push(char)
	}

	/**
	 * ( -- char )
	 * char is the character value for a space.
	 */
	function BL() { push(32) }

	/**
	 * CR ( -- )
	 * Cause subsequent output to appear at the beginning of the next line.
	 */
	function CR() { write('\n') }

	/**
	 * SPACE ( -- )
	 * Display one space.
	 */
	function SPACE()
	{
		BL()
		EMIT()
	}

	/**
	 * . ( n -- )
	 * Display n in free field format.
	 */
	function DOT()
	{
		const n = pop()
		write('' + n)
		SPACE()
	}

	/**
	 * .S ( -- )
	 * Copy and display the values currently on the data stack.
	 */
	function DOT_S()
	{
		DEPTH()
		const length = pop()
		let index = 0
		while (index < length) {
			push(length - index - 1)
			PICK()
			DOT()
			index += 1
		}

		push('<'.charCodeAt(0))
		EMIT()
		push('t'.charCodeAt(0))
		EMIT()
		push('o'.charCodeAt(0))
		EMIT()
		push('p'.charCodeAt(0))
		EMIT()
	}

	/**
	 * QUIT ( -- ) ( R: i * x -- )
	 * Empty the return stack, store zero in SOURCE-ID if it is present,
	 * make the user input device the input source,
	 * and enter interpretation state.
	 * Do not display a message.
	 */
	function QUIT()
	{
		// Empty return stack
		rEmpty()

		// Empty input buffer
		let index = 0
		while (index < INPUT_BUFFER_SIZE) {
			cStore(32, INPUT_BUFFER_ADDR + index)
			index += 1
		}
		store(0, INPUT_BUFFER_CHARS_ADDR)
		store(0, TO_IN_ADDR)

		// Enter Interpretation state
		LEFT_BRACKET()
	}

	/**
	 * ABORT ( i * x -- ) ( R: j * x -- )
	 * Empty the data stack and perform the function of QUIT,
	 * which includes emptying the return stack,
	 * without displaying a message.
	 */
	function ABORT()
	{
		// Empty data stack
		empty()
		QUIT()
	}

	/**
	 * STATE ( -- a-addr )
	 * a-addr is the address of a cell containing the compilation-state flag.
	 * STATE is true when in compilation state, false otherwise.
	 * Only the following standard words alter the value in STATE:
	 * `:`,  `;`,  `ABORT`, `QUIT`, `:NONAME`, `[`,  `]`
	 */
	function STATE() { push(STATE_ADDR) }

	/**
	 * ] ( -- )
	 * Enter compilation state.
	 */
	function RIGHT_BRACKET()
	{
		TRUE()
		STATE()
		STORE()
	}

	/**
	 * [ ( -- )
	 * Enter interpretation state.
	 */
	function LEFT_BRACKET()
	{
		FALSE()
		STATE()
		STORE()
	}

	/**
	 * : ( C: "<spaces>name" -- colon-sys )
	 * Skip leading space delimiters. Parse name delimited by a space.
	 * Create a definition for name, called a "colon definition".
	 * Enter compilation state and start the current definition, producing colon-sys.
	 */
	function COLON()
	{
		ALIGN()
		HERE()
		const nfa = pop()
		CREATE()

		// Set hidden flag
		const flag = cFetch(nfa+31) | Hidden
		cStore(flag, nfa+31)

		// Set XT for colon-def: nestRTS
		const xt = 100_000*(nfa+48) + NATIVE_XT_ADDR+3
		store(xt, nfa+40)

		// Enter compilation state
		RIGHT_BRACKET()
	}

	/**
	 * ; ( C: colon-sys -- ) ( R: nest-sys -- )
	 * End the current definition, allow it to be found in the dictionary and
	 * enter interpretation state, consuming colon-sys.
	 * If the data-space pointer is not aligned, reserve enough data space to align it.
	 */
	function SEMICOLON()
	{
		// Unset hidden flag
		const nfa  = fetch(CURRENT_DEF_ADDR)
		const flag = cFetch(nfa+31) & ~Hidden
		cStore(flag, nfa+31)

		// Set XT for end of colon-def: unNestRTS
		HERE()
		const addr = pop()
		push(100_000*addr + NATIVE_XT_ADDR+4)
		COMMA()

		// Exit compilation state
		LEFT_BRACKET()
		ALIGN()
	}

	/**
	 * ( -- )
	 * Make the most recent definition an immediate word.
	 */
	function IMMEDIATE()
	{
		const nfa = fetch(CURRENT_DEF_ADDR)

		// Set Immediate flag
		const flag = cFetch(nfa+31) | Immediate
		cStore(flag, nfa+31)
	}

	// noinspection JSUnusedGlobalSymbols
	return {interpret, pop}
}

module.exports = {
	forth,
}
