# Vocabulary

Adapted from mattpocock/skills `codebase-design` (MIT). Use these words exactly in the report; do not mix in "component", "service" or "layer".

- **Module**: anything with an interface and an implementation (a function, a class, a package, a slice).
- **Interface**: everything a caller must know to use a module: signatures, types, invariants, error modes, ordering, configuration. Not only the type signature.
- **Implementation**: the code behind the interface.
- **Depth**: leverage at the interface: much behavior behind a small interface is deep; an interface about as large as its implementation is shallow.
- **Seam**: a place where behavior can change without editing the code at that place (where the interface lives).
- **Adapter**: a concrete thing that satisfies an interface at a seam.
- **Leverage**: what callers get from depth: more capability per unit of interface learned.
- **Locality**: what maintainers get from depth: change, bugs and knowledge concentrate in one place.

## Deletion test

Imagine deleting the module. If the complexity vanishes, the module was a pass-through and not worth its interface. If the complexity reappears across N callers, the module was earning its keep. A module that fails the test is a candidate to merge into its caller; one that passes but has a wide interface is a candidate to deepen.

## Signs of a deepening opportunity

- Shallow module: the interface repeats the implementation (a wrapper that forwards each argument).
- Leaking seam: callers must know the order of calls, an internal type or a flag to use it correctly.
- One concept spread over many small modules, so a change touches all of them (poor locality).
- Hard to test through its interface: tests mock internals or reach into private state.
- A seam with one adapter and no second in sight (a speculative seam).

## Principles

- Deepen: move behavior behind the interface; shrink the interface.
- Test through the interface; a deep module needs few tests at the seam.
- Two adapters make a real seam; one is a hypothetical.
