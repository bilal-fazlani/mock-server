# Global-mock dynamic history: reset UI + deletion cleanup

Follow-up to the dynamic scenario resolver feature. The dynamic-history store already
supports `ownerType: 'global'`, and global-mock endpoints can be pinned to the `dynamic`
scenario, accumulating history under `('global', systemSlug, endpoint)`. Two gaps remain.

## Gap 1 — Reset button for global mocks

The profile page has a "Reset dynamic history" button (`resetDynamicHistoryAction` +
`ScenarioConfig.tsx`). Global mocks have no equivalent. Add one.

**Store:** no change — `resetDynamicHistory(db, 'global', systemSlug, endpointName)`
already exists and is tested.

**Action** (`src/app/ui/global-mocks/actions.ts`): add `resetGlobalDynamicHistoryAction`,
bound with the two identifiers via `.bind(null, systemSlug, endpointName)`. Unlike the
profile action it reads nothing from `formData`.

```ts
export async function resetGlobalDynamicHistoryAction(
  systemSlug: string,
  endpointName: string,
): Promise<void> {
  if (!systemSlug || !endpointName) throw new Error('system and endpoint are required')
  await resetDynamicHistory(await getDb(), 'global', systemSlug, endpointName)
  revalidatePath('/ui/global-mocks')
}
```

No admin log: `saveGlobalMocks` writes none, and the admin-log helper is profile-keyed.
Parity is with the surrounding global-mocks code, not the profile code.

**UI** (`GlobalMocksForm.tsx`): render the button when `stored === 'dynamic'` (the *saved*
selection), inside the existing `<form>`, as
`<button formAction={resetGlobalDynamicHistoryAction.bind(null, system.slug, endpoint.name)}>`.

Deviation from "mirror the profile-side pattern": the profile button toggles on live client
state (`singleValue === 'dynamic'`) because `ScenarioConfig` is a client component.
`GlobalMocksForm` is a server component with a radio `ScenarioPicker`, so visibility keys off
the saved value. This is the more correct trigger — history only exists once saved as
`dynamic` — and avoids converting the form to a client component. A small `resetButton` +
footer style is added to `ProfileForm.module.css` (the module this form already uses).

## Gap 2 — Cleanup on deletion

`clearGlobalMockScenario` (only caller: `saveGlobalMocks`, when a global endpoint is reset to
the implicit default) is the global analog of `deleteProfile`. `deleteProfile` already drops
its dynamic history, so for parity `clearGlobalMockScenario` drops the `('global', system,
endpoint)` history inline:

```ts
export async function clearGlobalMockScenario(db, system, endpoint) {
  await db.collection('globalMockScenarios').deleteOne({ system, endpoint })
  await db.collection('dynamicHistory').deleteMany({
    ownerType: 'global', ownerKey: system, endpointName: endpoint,
  })
}
```

Deliberate asymmetry (matching the profile side): switching `dynamic → real` goes through
`upsertGlobalMockScenario` and keeps history; only clear-to-default (the deletion-equivalent)
drops it. Re-pinning to `dynamic` later starts fresh, exactly like a deleted-and-recreated
profile.

## TDD order

1. `tests/profiles/store.test.ts` — `clearGlobalMockScenario` drops `('global', …)` history.
2. `tests/global-mocks/actions.test.ts` — `resetGlobalDynamicHistoryAction` calls the store
   and revalidates (mock-based, matching existing style).
3. `tests/ui/` — `GlobalMocksForm` renders the reset button iff `stored === 'dynamic'`.

## Docs

Per AGENTS.md, after implementing, check `guide/reference/dynamic.md` and `configuration.md`;
ask before editing if described behavior changed.
