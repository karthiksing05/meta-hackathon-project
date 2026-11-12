//! The builtin function catalog (spec A6). This file is the **semantic
//! contract** between the type checker (`mg-lang`) and the evaluator
//! (`mg-runtime`). Both must follow the doc comment on each variant exactly.
//!
//! Conventions:
//! * "error" means a runtime error: the current rule is rolled back and an
//!   `E_RUNTIME` diagnostic is recorded.
//! * Indices are `int`. Negative indices are errors unless stated otherwise.
//! * `num` means `int` or `float`. When any `num` argument is a float, int
//!   arguments are widened (the checker inserts `ir::Expr::ToFloat`), and the
//!   result is a float.
//! * Lambda arguments are `ir::Expr::Lambda`. The builtin evaluates them by
//!   writing the parameter slots and evaluating the body.
//! * Every result list/set/map/grid is limited to `limits::MAX_COLLECTION_LEN`
//!   items, or it's an error.

macro_rules! builtins {
    ($( $(#[$doc:meta])* $variant:ident = $name:literal, )*) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
        pub enum Builtin { $( $(#[$doc])* $variant, )* }

        impl Builtin {
            pub const ALL: &'static [Builtin] = &[ $( Builtin::$variant, )* ];

            pub fn name(self) -> &'static str {
                match self { $( Builtin::$variant => $name, )* }
            }

            pub fn from_name(s: &str) -> Option<Builtin> {
                match s { $( $name => Some(Builtin::$variant), )* _ => None }
            }
        }
    };
}

builtins! {
    // ── Math ────────────────────────────────────────────────────────────
    /// `abs(num) -> same`
    Abs = "abs",
    /// `min(num, num, ...) -> num` (2+ args). Mixed → float.
    Min = "min",
    /// `max(num, num, ...) -> num` (2+ args). Mixed → float.
    Max = "max",
    /// `clamp(x, lo, hi) -> num`. `min(max(x, lo), hi)`.
    Clamp = "clamp",
    /// `floor(num) -> int`. Int input is returned unchanged. Non-finite → error.
    Floor = "floor",
    /// `ceil(num) -> int`.
    Ceil = "ceil",
    /// `round(num) -> int`. Halves round away from zero (`round(2.5) == 3`, `round(-2.5) == -3`).
    Round = "round",
    /// `sqrt(num) -> float`. Negative → NaN (not an error).
    Sqrt = "sqrt",
    /// `log2(num) -> float`. `log2(0)` is `-inf` (not an error).
    Log2 = "log2",
    /// `sin(num) -> float` (radians)
    Sin = "sin",
    /// `cos(num) -> float` (radians)
    Cos = "cos",
    /// `lerp(a: num, b: num, t: num) -> float`. Also `lerp(vec2, vec2, t) -> vec2`.
    Lerp = "lerp",
    /// `hash(any) -> float` in `[0, 1)`. `unit_f64(StableHasher(value))`. Pure:
    /// allowed everywhere, unlike the random builtins.
    Hash = "hash",

    // ── Lists ───────────────────────────────────────────────────────────
    /// `len(list|set|map|string) -> int`. Strings count Unicode scalar values.
    Len = "len",
    /// `first(list<T>) -> T`. Empty → error.
    First = "first",
    /// `last(list<T>) -> T`. Empty → error.
    Last = "last",
    /// `get_or(list<T>, int, T) -> T`; `get_or(map<K,V>, K, V) -> V`;
    /// `get_or(grid<T>, ivec2, T) -> T`. Out of range / missing → default.
    GetOr = "get_or",
    /// `slice(list<T>, start: int, end: int) -> list<T>`. End exclusive. Both
    /// bounds are clamped to `[0, len]`; `end < start` gives `[]`.
    Slice = "slice",
    /// `take(list<T>, n) -> list<T>`. First `n` items; `n` clamped to `[0, len]`.
    Take = "take",
    /// `drop(list<T>, n) -> list<T>`. All but the first `n`; `n` clamped.
    Drop = "drop",
    /// `concat(list<T>, list<T>, ...) -> list<T>` (2+ args). Also `concat(string, string, ...)`.
    Concat = "concat",
    /// `push(list<T>, T) -> list<T>`. Appends.
    Push = "push",
    /// `set_at(list<T>, i, T) -> list<T>`. `0 <= i < len` else error.
    SetAt = "set_at",
    /// `insert_at(list<T>, i, T) -> list<T>`. `0 <= i <= len` else error.
    InsertAt = "insert_at",
    /// `remove_at(list<T>, i) -> list<T>`. `0 <= i < len` else error.
    RemoveAt = "remove_at",
    /// `reverse(list<T>) -> list<T>`. Also `reverse(string) -> string`.
    Reverse = "reverse",
    /// `repeat(v: T, n: int) -> list<T>`. `n < 0` → `[]`.
    Repeat = "repeat",
    /// `range(n) -> list<int>` = `[0, 1, ..., n-1]`; `range(a, b)` = `[a, ..., b-1]`.
    /// Empty when the end is not above the start.
    Range = "range",
    /// `index_of(list<T>, T) -> int`. First match, or `-1`. Also
    /// `index_of(string, string) -> int`: char index of the first occurrence, or `-1`.
    IndexOf = "index_of",
    /// `contains(list<T>, T) -> bool`; `contains(set<T>, T)`; `contains(string, string)` (substring).
    Contains = "contains",

    // ── Higher-order ────────────────────────────────────────────────────
    /// `map(list<T>, T => U) -> list<U>`. Also `map(list<T>, (T, int) => U)` with the index.
    Map = "map",
    /// `filter(list<T>, T => bool) -> list<T>`. Also `(T, int) => bool`.
    Filter = "filter",
    /// `fold(list<T>, init: A, (A, T) => A) -> A`. Left to right.
    Fold = "fold",
    /// `any(list<T>, T => bool) -> bool`. Short-circuits. `any([], _) == false`.
    Any = "any",
    /// `all(list<T>, T => bool) -> bool`. Short-circuits. `all([], _) == true`.
    All = "all",
    /// `count(list<T>, T => bool) -> int`.
    Count = "count",
    /// `find(list<T>, T => bool) -> T?`. First match or `none`.
    Find = "find",
    /// `sort_by(list<T>, T => K) -> list<T>`. Stable, ascending by `K` using
    /// structural `Value` ordering. Each key is computed once.
    SortBy = "sort_by",
    /// `sum(list<num>) -> num`. `sum([]) == 0` (int; float if the element type is float).
    Sum = "sum",
    /// `zip(list<A>, list<B>) -> list<{a: A, b: B}>`. Length = the shorter one.
    Zip = "zip",

    // ── Sets and maps ───────────────────────────────────────────────────
    /// `set_of(list<T>) -> set<T>`.
    SetOf = "set_of",
    /// `add(set<T>, T) -> set<T>`.
    Add = "add",
    /// `remove(set<T>, T) -> set<T>`; `remove(map<K,V>, K) -> map<K,V>`. Missing is fine.
    Remove = "remove",
    /// `has(set<T>, T) -> bool`; `has(map<K,V>, K) -> bool`.
    Has = "has",
    /// `map_of(list of [K, V] pairs) -> map<K,V>`. The argument is normally a
    /// list literal of 2-element list literals (`map_of([['butler', 0]])`), which
    /// the checker types as pairs even though K and V differ. Later pairs win.
    MapOf = "map_of",
    /// `put(map<K,V>, K, V) -> map<K,V>`.
    Put = "put",
    /// `keys(map<K,V>) -> list<K>`, ascending.
    Keys = "keys",
    /// `values(map<K,V>) -> list<V>` in key order; `values(grid<T>) -> list<T>` row-major.
    Values = "values",

    // ── Grids ───────────────────────────────────────────────────────────
    /// `grid(w: int, h: int, v: T) -> grid<T>`. `w, h >= 0` and `w*h <= MAX_COLLECTION_LEN` else error.
    Grid = "grid",
    /// `width(grid<T>) -> int`
    Width = "width",
    /// `height(grid<T>) -> int`
    Height = "height",
    /// `cells(grid<T>) -> list<ivec2>`, row-major (y outer, x inner).
    Cells = "cells",
    /// `in_grid(grid<T>, ivec2) -> bool`
    InGrid = "in_grid",
    /// `grid_map(grid<T>, (T, ivec2) => U) -> grid<U>`. Also `T => U`.
    GridMap = "grid_map",
    /// `neighbors4(ivec2) -> list<ivec2>` = `[c+up, c+right, c+down, c+left]`. Not filtered.
    Neighbors4 = "neighbors4",
    /// `neighbors8(ivec2) -> list<ivec2>`: clockwise from up:
    /// up, up-right, right, down-right, down, down-left, left, up-left. Not filtered.
    Neighbors8 = "neighbors8",
    /// `lines(grid<T>, dir: ivec2) -> list<list<ivec2>>`. Rows for left/right,
    /// columns for up/down, each starting from the edge being pushed toward:
    /// left: x = 0 → w-1; right: x = w-1 → 0; up: y = 0 → h-1; down: y = h-1 → 0.
    /// Rows are listed y = 0..h, columns x = 0..w. Any other dir → error.
    Lines = "lines",
    /// `write_line(grid<T>, coords: list<ivec2>, values: list<T>) -> grid<T>`.
    /// Lengths must match and every coord must be in the grid, else error.
    WriteLine = "write_line",

    // ── Space ───────────────────────────────────────────────────────────
    /// `vec(x, y)`: two ints → `ivec2`; otherwise → `vec2`.
    Vec = "vec",
    /// `length(ivec2|vec2) -> float`
    Length = "length",
    /// `dist(a, b) -> float` (both ivec2 or both vec2; mixed widens to vec2)
    Dist = "dist",
    /// `normalize(ivec2|vec2) -> vec2`. Zero vector → `vec(0.0, 0.0)`.
    Normalize = "normalize",
    /// `in_bounds(p: ivec2|vec2, w: num, h: num) -> bool`: `0 <= x < w and 0 <= y < h`.
    InBounds = "in_bounds",
    /// `coords(w: int, h: int) -> list<ivec2>`, row-major.
    Coords = "coords",
    /// `overlaps_circle(p1, r1, p2, r2) -> bool`: `dist(p1, p2) < r1 + r2`.
    OverlapsCircle = "overlaps_circle",
    /// `overlaps_rect(p1, s1, p2, s2) -> bool`: axis-aligned boxes with top-left `p`
    /// and size `s` overlap with positive area (touching edges don't count).
    OverlapsRect = "overlaps_rect",

    // ── Text ────────────────────────────────────────────────────────────
    /// `chars(string) -> list<string>` (one string per Unicode scalar value).
    Chars = "chars",
    /// `upper(string) -> string`
    Upper = "upper",
    /// `lower(string) -> string`
    Lower = "lower",
    /// `join(list<string>, sep: string) -> string`
    Join = "join",
    /// `str(any) -> string`, formatted by `Value`'s `Display`.
    Str = "str",
    /// `in_dictionary(string) -> bool`. Case-insensitive lookup in the engine's
    /// built-in English word list.
    InDictionary = "in_dictionary",

    // ── Options ─────────────────────────────────────────────────────────
    /// `is_none(T?) -> bool`
    IsNone = "is_none",
    /// `or_else(T?, T) -> T`
    OrElse = "or_else",

    // ── v0.2: text ──────────────────────────────────────────────────────
    /// `split(string, sep: string) -> list<string>`. `sep == ''` splits into chars.
    Split = "split",
    /// `trim(string) -> string`. Unicode whitespace at both ends.
    Trim = "trim",
    /// `substr(string, start: int, end: int) -> string`. Char indices, end
    /// exclusive, clamped like `slice`.
    Substr = "substr",
    /// `starts_with(string, prefix: string) -> bool`
    StartsWith = "starts_with",
    /// `ends_with(string, suffix: string) -> bool`
    EndsWith = "ends_with",
    /// `replace(string, from: string, to: string) -> string`. Replaces all
    /// occurrences; an empty `from` returns the string unchanged.
    Replace = "replace",
    /// `parse_int(string) -> int?`. Trims first; optional leading `-`/`+`,
    /// then decimal digits only; `none` otherwise or on overflow.
    ParseInt = "parse_int",

    // ── v0.2: math and space ────────────────────────────────────────────
    /// `atan2(y: num, x: num) -> float` (radians).
    Atan2 = "atan2",
    /// `sign(num) -> same kind`: -1, 0 or 1 (`sign(-0.0) == 0.0`).
    Sign = "sign",
    /// `pow(num, num) -> float`.
    Pow = "pow",
    /// `fmod(num, num) -> float`. Result has the sign of the dividend; divisor 0 → error.
    Fmod = "fmod",
    /// `angle(ivec2|vec2) -> float` = `atan2(y, x)`.
    Angle = "angle",
    /// `from_angle(radians: num) -> vec2` = `vec(cos(a), sin(a))`.
    FromAngle = "from_angle",
    /// `rotate(ivec2|vec2, radians: num) -> vec2`.
    Rotate = "rotate",
    /// `min_of(list<num>) -> num`. Empty → error.
    MinOf = "min_of",
    /// `max_of(list<num>) -> num`. Empty → error.
    MaxOf = "max_of",

    // ── Random (seeded; only in state init and effects) ─────────────────
    /// `random_int(a: int, b: int) -> int`, inclusive of both ends.
    RandomInt = "random_int",
    /// `random_float(a: num, b: num) -> float` in `[a, b)`.
    RandomFloat = "random_float",
    /// `pick(list<T>) -> T`. Empty → error.
    Pick = "pick",
    /// `shuffle(list<T>) -> list<T>`. Fisher-Yates from the last index down.
    Shuffle = "shuffle",
    /// `chance(p: num) -> bool`: `next_f64() < p` (one draw).
    Chance = "chance",
    /// `weighted(values: list<T>, weights: list<num>) -> T`. Lengths must match,
    /// weights must be >= 0 with a positive total, else error. Draws one
    /// `next_f64() * total` and walks the cumulative sum.
    Weighted = "weighted",
}

impl Builtin {
    /// Builtins that consume the seeded RNG. Forbidden in `when`, `objectives`,
    /// `functions`, input guards and presentation (`E_RANDOM_IN_PURE`).
    pub fn is_random(self) -> bool {
        matches!(
            self,
            Builtin::RandomInt
                | Builtin::RandomFloat
                | Builtin::Pick
                | Builtin::Shuffle
                | Builtin::Weighted
                | Builtin::Chance
        )
    }

    /// Builtins that take a lambda argument, and at which argument index.
    pub fn lambda_arg(self) -> Option<usize> {
        match self {
            Builtin::Map
            | Builtin::Filter
            | Builtin::Any
            | Builtin::All
            | Builtin::Count
            | Builtin::Find
            | Builtin::SortBy
            | Builtin::GridMap => Some(1),
            Builtin::Fold => Some(2),
            _ => None,
        }
    }
}

/// Named constants (lowest priority in name lookup).
/// `up = vec(0,-1)`, `down = vec(0,1)`, `left = vec(-1,0)`, `right = vec(1,0)`
/// (all `ivec2`), `now` (game time in ms, `int`) and `pi` (`float`, v0.2).
pub const CONSTANTS: &[&str] = &["up", "down", "left", "right", "now", "pi"];

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn names_round_trip() {
        for b in Builtin::ALL {
            assert_eq!(Builtin::from_name(b.name()), Some(*b));
        }
    }
}
