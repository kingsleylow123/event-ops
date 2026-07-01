import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getCSuiteConfig, authMode } from '../config'

// config reads process.env at call time; set/restore around each assertion.
async function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {}
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k]
    if (env[k] === undefined) delete process.env[k]
    else process.env[k] = env[k]
  }
  try { fn() } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  }
}

const CLEAR = {
  MANAGER_MODEL: undefined, HEAD_MODEL: undefined,
  SALES_MODEL: undefined, OPS_MODEL: undefined, FINANCE_MODEL: undefined, MARKETING_MODEL: undefined,
  C_SUITE_DEBATE_ROUNDS: undefined,
}

test('defaults: Opus manager, Sonnet heads', () => {
  withEnv(CLEAR, () => {
    const c = getCSuiteConfig()
    assert.equal(c.managerModel, 'claude-opus-4-8')
    assert.equal(c.headModel, 'claude-sonnet-4-6')
    assert.equal(c.perHeadModel.finance, 'claude-sonnet-4-6')
    assert.equal(c.debateRounds, 1)
  })
})

test('env overrides models, including a single per-head override', () => {
  withEnv({ ...CLEAR, MANAGER_MODEL: 'claude-opus-4-8', HEAD_MODEL: 'claude-haiku-4-5', FINANCE_MODEL: 'claude-sonnet-4-6' }, () => {
    const c = getCSuiteConfig()
    assert.equal(c.headModel, 'claude-haiku-4-5')
    assert.equal(c.perHeadModel.sales, 'claude-haiku-4-5')     // inherits HEAD_MODEL
    assert.equal(c.perHeadModel.finance, 'claude-sonnet-4-6')  // per-head override wins
  })
})

test('debateRounds is clamped to [1,3]', () => {
  withEnv({ ...CLEAR, C_SUITE_DEBATE_ROUNDS: '0' }, () => assert.equal(getCSuiteConfig().debateRounds, 1))
  withEnv({ ...CLEAR, C_SUITE_DEBATE_ROUNDS: '9' }, () => assert.equal(getCSuiteConfig().debateRounds, 3))
  withEnv({ ...CLEAR, C_SUITE_DEBATE_ROUNDS: '2' }, () => assert.equal(getCSuiteConfig().debateRounds, 2))
})

test('authMode prefers the Max subscription (OAuth) over the API key', () => {
  withEnv({ CLAUDE_CODE_OAUTH_TOKEN: 'tok', ANTHROPIC_API_KEY: 'key' }, () => assert.equal(authMode(), 'oauth'))
  withEnv({ CLAUDE_CODE_OAUTH_TOKEN: undefined, ANTHROPIC_API_KEY: 'key' }, () => assert.equal(authMode(), 'apikey'))
  withEnv({ CLAUDE_CODE_OAUTH_TOKEN: undefined, ANTHROPIC_API_KEY: undefined }, () => assert.equal(authMode(), 'none'))
})
