# Rust runtime notice assets

`rust-1.98.1/` preserves the upstream notice material for the Rust runtime
used by Seshat's five supported targets. The directory is pinned to
`rustc 1.98.1 (48a229cea 2026-09-01)`. Do not use it for another Rust release;
add a separately pinned directory after repeating the source and hash checks.
The file inventory and provenance are in
[`rust-1.98.1/provenance.json`](rust-1.98.1/provenance.json).

## Notice files

The package notice should carry these files, in this order, under a heading
that identifies the exact Rust build:

1. `COPYRIGHT-library.html`
2. `licenses/Apache-2.0.txt`
3. `licenses/MIT.txt`
4. `licenses/Unicode-3.0.txt`
5. `licenses/BSD-2-Clause.txt`
6. `licenses/LLVM-exception.txt`
7. `compiler-builtins-LICENSE.txt`
8. `compiler-builtins-CREDITS.TXT`
9. `libm-LICENSE.txt`

Copy the legal text byte-for-byte. Keep the upstream copyright holders and
attributions. The compiler-builtins expression is `MIT AND Apache-2.0
WITH LLVM-exception`; its license file also records the LLVM compiler-rt
attribution. The pinned compiler-rt `CREDITS.TXT` keeps that referenced list
at the LLVM commit used by Rust 1.98.1. The libm file retains the MIT terms and
its musl, CORE-MATH, and Jorge Aparicio credits.

`COPYRIGHT-library.html` is Rust's generated standard-library inventory. Rust
describes it as covering standard-library source and third-party crates used
to build the standard library. It spans multiple targets, so an entry in the
file is not a claim that every listed component is linked into every Seshat
executable. Keep that scope sentence beside the copied file instead of
presenting the inventory as a target-specific dependency graph.

## Integration checks

Before packaging, require the exact Rust version and commit recorded in
`provenance.json`. Check every asset's byte count and SHA-256 before appending
it to `THIRD_PARTY_NOTICES.txt`; fail closed if the toolchain or an asset hash
changes. Keep `source-facts/` in the audit evidence only. It records why the
target caveats below apply and is not notice payload.

The pinned `std-Cargo.toml` selects `fortanix-sgx-abi` only for
`x86_64-fortanix-unknown-sgx` and `r-efi`/`r-efi-alloc` only for UEFI targets.
Neither branch is one of Seshat's five supported targets. Their MPL and
LGPL-2.1-or-later alternatives therefore must not be described as blanket
licenses for those targets. The pinned `unwind-lib.rs` has no extra unwinder
for MSVC and links `gcc_s` for the ordinary non-`crt-static` Linux GNU path.
Final native link evidence still decides whether any additional target
runtime notice is needed.
