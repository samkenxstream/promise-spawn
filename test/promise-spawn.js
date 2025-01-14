const t = require('tap')
const requireInject = require('require-inject')
const Minipass = require('minipass')
const EE = require('events')

const isPipe = (stdio = 'pipe', fd) =>
  stdio === 'pipe' || stdio === null ? true
  : Array.isArray(stdio) ? isPipe(stdio[fd], fd)
  : false

class MockProc extends EE {
  constructor (cmd, args, opts) {
    super()
    this.cmd = cmd
    this.args = args
    this.opts = opts
    this.stdin = isPipe(opts.stdio, 0) ? new Minipass() : null
    this.stdout = isPipe(opts.stdio, 1) ? new Minipass() : null
    this.stderr = isPipe(opts.stdio, 2) ? new Minipass() : null
    this.code = null
    this.signal = null
    process.nextTick(() => this.run())
  }

  exit (code) {
    this.code = code
    this.emit('exit', this.code, this.signal)
    if (this.stdout && this.stderr) {
      let stdoutEnded = false
      let stderrEnded = false
      this.stdout.on('end', () => {
        stdoutEnded = true
        if (stderrEnded)
          this.emit('close', this.code, this.signal)
      })
      this.stderr.on('end', () => {
        stderrEnded = true
        if (stdoutEnded)
          this.emit('close', this.code, this.signal)
      })
      this.stdout.end()
      this.stderr.end()
    } else
      this.emit('close', this.code, this.signal)
  }

  kill (signal) {
    this.signal = signal
    this.exit(null)
  }

  writeOut (m) {
    this.stdout && this.stdout.write(m)
  }

  writeErr (m) {
    this.stderr && this.stderr.write(m)
  }

  run () {
    switch (this.cmd) {
      case 'cat':
        this.stdin.on('data', c => this.writeOut(c))
        this.stdin.on('end', () => this.exit(0))
        return
      case 'not found':
        return this.emit('error', new Error('command not found'))
      case 'signal':
        this.writeOut('stdout')
        this.writeErr('stderr')
        return this.kill('SIGFAKE')
      case 'pass':
        this.writeOut('OK :)')
        return this.exit(0)
      case 'fail':
        this.writeOut('not ok :(')
        this.writeErr('Some kind of helpful error')
        return this.exit(1)
      case 'whoami':
        this.writeOut(`UID ${this.opts.uid}\n`)
        this.writeOut(`GID ${this.opts.gid}\n`)
        return this.exit(0)
      case 'stdout-fail':
        this.stdout.emit('error', new Error('stdout error'))
        return this.exit(1)
      case 'stderr-fail':
        this.stderr.emit('error', new Error('stderr error'))
        return this.exit(1)
    }
  }
}

const promiseSpawn = requireInject('../', {
  child_process: {
    spawn: (cmd, args, opts) => new MockProc(cmd, args, opts),
  },
})

t.test('not found', t => t.rejects(promiseSpawn('not found', [], {}), {
  message: 'command not found',
}))

t.test('not found, with extra', t => t.rejects(promiseSpawn('not found', [], {stdioString: true}, {a: 1}), {
  message: 'command not found',
  stdout: '',
  stderr: '',
  a: 1,
}))

t.test('pass', t => t.resolveMatch(promiseSpawn('pass', [], {stdioString: true}, {a: 1}), {
  code: 0,
  signal: null,
  stdout: 'OK :)',
  stderr: '',
  a: 1,
}))

t.test('pass, default opts', t => t.resolveMatch(promiseSpawn('pass', []), {
  code: 0,
  signal: null,
}))

t.test('pass, share stdio', t => t.resolveMatch(promiseSpawn('pass', [], { stdio: 'inherit'}, {a: 1}), {
  code: 0,
  signal: null,
  stdout: null,
  stderr: null,
  a: 1,
}))

t.test('pass, share stdout', t => t.resolveMatch(promiseSpawn('pass', [], { stdioString: true, stdio: ['pipe', 'inherit', 'pipe']}, {a: 1}), {
  code: 0,
  signal: null,
  stdout: null,
  stderr: '',
  a: 1,
}))

t.test('pass, share stderr', t => t.resolveMatch(promiseSpawn('pass', [], { stdioString: true, stdio: ['pipe', 'pipe', 'inherit']}, {a: 1}), {
  code: 0,
  signal: null,
  stdout: 'OK :)',
  stderr: null,
  a: 1,
}))

t.test('fail', t => t.rejects(promiseSpawn('fail', [], {}, {a: 1}), {
  message: 'command failed',
  code: 1,
  signal: null,
  stdout: Buffer.from('not ok :('),
  stderr: Buffer.from('Some kind of helpful error'),
  a: 1,
}))

t.test('fail, shared stdio', t => t.rejects(promiseSpawn('fail', [], { stdio: 'inherit' }, {a: 1}), {
  message: 'command failed',
  code: 1,
  signal: null,
  stdout: null,
  stderr: null,
  a: 1,
}))

t.test('signal', t => t.rejects(promiseSpawn('signal', [], {}, {a: 1}), {
  message: 'command failed',
  code: null,
  signal: 'SIGFAKE',
  stdout: Buffer.from('stdout'),
  stderr: Buffer.from('stderr'),
  a: 1,
}))

t.test('stdio errors', t => {
  t.rejects(promiseSpawn('stdout-fail', [], {}), {
    message: 'stdout error',
  })
  t.rejects(promiseSpawn('stderr-fail', [], {}), {
    message: 'stderr error',
  })
  t.end()
})

t.test('expose process stdin', t => {
  const p = promiseSpawn('cat', [], { stdio: 'pipe' })
  t.resolveMatch(p, {
    code: 0,
    signal: null,
    stdout: Buffer.from('hello'),
    stderr: Buffer.alloc(0),
  })
  t.end()
  p.stdin.write('hell')
  setTimeout(() => p.stdin.end('o'))
})

t.test('expose process', t => {
  const p = promiseSpawn('cat', [], { stdio: 'pipe' })
  t.resolveMatch(p, {
    code: 0,
    signal: null,
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
  })
  t.end()
  setTimeout(() => p.process.exit(0))
})
