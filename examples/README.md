# Companion code for articles

Put a self-contained example in `examples/<example-slug>/` and include it in
the same pull request as the article under `draft/`. The example folder stays
here when a maintainer moves the article into `content/posts/` for publication.
You can also link to an example in your own public repository.

Include the source, a README with prerequisites and exact setup commands,
dependency lockfiles where supported, and any files needed to run it.
Keep downloaded dependencies, caches, and build output out of Git with a local
`.gitignore`. Include upstream licences for any vendored dependencies.

Link to repository-hosted code with its full URL:

```markdown
[Companion example](https://github.com/foojayio/website/tree/main/examples/your-example)
```

The link becomes available when the example is merged into Foojay's `main`
branch. Reviewers can read and run the example from the pull request branch
before then. A relative `examples/...` link in an article would resolve under
the article's web URL, rather than in GitHub.

These folders hold source code. Hugo does not build or deploy the apps to
foojay.io. Readers clone the repository and follow the example's README;
an externally hosted demo can have a separate link in the article.

## TeaVM environment example

[`teavm-environment/`](teavm-environment/README.md) accompanies **Run Java in the
Browser with TeaVM**. From a fresh clone:

```sh
git clone https://github.com/foojayio/website.git
cd website/examples/teavm-environment
npm ci
npm run dev
```
