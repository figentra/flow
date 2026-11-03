# Third-party notices

Figentra Flow includes text derived from the following project. Each derived file says so in its front matter
(`derived-from: …`); the line is removed when a file is rewritten from scratch.

## github/spec-kit 1.0.10

The command texts in `assets/flow/presets/*/commands/` and the checklist and constitution templates in
`assets/flow/templates/` are derived from GitHub's Spec Kit (https://github.com/github/spec-kit), used under the
MIT License:

```text
MIT License

Copyright GitHub, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## The stackra preset's skills and reference

`assets/flow/presets/stackra/skills/` and `assets/flow/presets/stackra/reference/` are copied from Stackra core
(STA-1945). Some of them are vendored from upstream projects under MIT or Apache-2.0: each such folder keeps its
upstream `LICENSE` (and `NOTICE`, where the upstream has one), and `fflow sync` renders those files with the rest of
the folder. The others are Figentra's own, under this package's MIT licence.
