// communityIntegration.test.js — Frontend unit tests for Phase 5.2.7 Community and Auxiliary Sections Integration
// Run with: node --test src/pages/community/__tests__/communityIntegration.test.js

import test from 'node:test'
import assert from 'node:assert/strict'

test('Phase 5.2.7 — Community Deep-Link and Reciprocal Routing Contracts', async (t) => {
  await t.test('Announcements to Community preview builds clean ?post=<id> URL', () => {
    const buildPostPermalink = (postId, basePath = '/community') => {
      if (!postId) return basePath
      return `${basePath}?post=${encodeURIComponent(postId)}`
    }

    assert.equal(buildPostPermalink(42), '/community?post=42')
    assert.equal(buildPostPermalink('99'), '/community?post=99')
    assert.equal(buildPostPermalink(null), '/community')
    assert.equal(buildPostPermalink(undefined), '/community')
  })

  await t.test('Community URL search params extracts post id correctly', () => {
    const parsePostParam = (searchString) => {
      const params = new URLSearchParams(searchString)
      return params.get('post')
    }

    assert.equal(parsePostParam('?post=15'), '15')
    assert.equal(parsePostParam('?post=15&view=feed'), '15')
    assert.equal(parsePostParam(''), null)
    assert.equal(parsePostParam('?category=general'), null)
  })

  await t.test('Dismissing targeted post error removes ?post parameter cleanly', () => {
    const clearPostParam = (initialQuery) => {
      const params = new URLSearchParams(initialQuery)
      params.delete('post')
      const remaining = params.toString()
      return remaining ? `?${remaining}` : ''
    }

    assert.equal(clearPostParam('?post=99999'), '')
    assert.equal(clearPostParam('?post=99999&barangay=1'), '?barangay=1')
  })

  await t.test('Sidebar dispatches to distinct parameter contracts (?alert vs ?article)', () => {
    const buildSidebarAlertUrl = (alertId) => `/announcements?alert=${encodeURIComponent(alertId)}`
    const buildSidebarArticleUrl = (articleId) => `/announcements?article=${encodeURIComponent(articleId)}`

    // EmergencyAlert contract: ?alert=<id>
    const alertUrl = buildSidebarAlertUrl(5)
    assert.equal(alertUrl, '/announcements?alert=5')
    const parsedAlert = new URL(alertUrl, 'https://wastewatch.lucena.gov.ph')
    assert.equal(parsedAlert.searchParams.get('alert'), '5')
    assert.equal(parsedAlert.searchParams.get('article'), null)

    // Official NewsItem contract: ?article=<id>
    const articleUrl = buildSidebarArticleUrl(12)
    assert.equal(articleUrl, '/announcements?article=12')
    const parsedArticle = new URL(articleUrl, 'https://wastewatch.lucena.gov.ph')
    assert.equal(parsedArticle.searchParams.get('article'), '12')
    assert.equal(parsedArticle.searchParams.get('alert'), null)
  })

  await t.test('Feed merging prepends remote injected post only if not already in feed', () => {
    const mergeDisplayPosts = (posts, injectedPost) => {
      if (!injectedPost) return posts
      if (posts.some(p => String(p.id) === String(injectedPost.id))) return posts
      return [injectedPost, ...posts]
    }

    const existingPosts = [
      { id: 1, title: 'Barangay cleanup drive' },
      { id: 2, title: 'Composting workshop' },
    ]

    // Case 1: Post already in feed -> no duplication
    const resultExisting = mergeDisplayPosts(existingPosts, { id: 2, title: 'Composting workshop' })
    assert.equal(resultExisting.length, 2)
    assert.equal(resultExisting[0].id, 1)

    // Case 2: Post not in feed -> prepended
    const remotePost = { id: 99, title: 'Remote targeted post' }
    const resultRemote = mergeDisplayPosts(existingPosts, remotePost)
    assert.equal(resultRemote.length, 3)
    assert.equal(resultRemote[0].id, 99)
    assert.equal(resultRemote[1].id, 1)

    // Case 3: No injected post -> identical
    const resultNone = mergeDisplayPosts(existingPosts, null)
    assert.deepEqual(resultNone, existingPosts)
  })

  await t.test('Active scope resolution prioritizes explicit selection over user default', () => {
    const resolveScope = (selectedBarangay, user) => {
      if (selectedBarangay) return String(selectedBarangay)
      if (user?.barangay?.id) return String(user.barangay.id)
      if (user?.barangay && typeof user.barangay === 'number') return String(user.barangay)
      return 'all'
    }

    // User is from Barangay 3, but explicitly filters by Barangay 5
    assert.equal(resolveScope('5', { barangay: { id: 3 } }), '5')
    // No explicit filter, user belongs to Barangay 3
    assert.equal(resolveScope('', { barangay: { id: 3 } }), '3')
    // Unauthenticated user with no filter
    assert.equal(resolveScope('', null), 'all')
  })
})
