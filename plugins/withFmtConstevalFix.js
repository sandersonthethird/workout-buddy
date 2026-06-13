const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Config plugin: work around fmt 11's consteval format-string checks failing
 * to compile under newer Xcode/Clang (Xcode 26+), which breaks `pod`-built
 * targets (fmt, RCT-Folly) with errors like:
 *
 *   Call to consteval function 'fmt::basic_format_string<...>' is not a
 *   constant expression
 *
 * Defining FMT_USE_CONSTEVAL=0 makes fmt validate format strings at runtime
 * instead of via consteval, sidestepping the compiler bug. It's a no-op on
 * toolchains that already build fmt cleanly (e.g. EAS's pinned Xcode), so it's
 * safe to apply everywhere.
 *
 * Injected into the generated Podfile's post_install block so it survives
 * `expo prebuild` (the ios/ dir is gitignored and regenerated each build).
 */

const SNIPPET = `
    # Injected by plugins/withFmtConstevalFix.js
    fmt_base_h = File.join(installer.sandbox.root, 'fmt', 'include', 'fmt', 'base.h')
    if File.exist?(fmt_base_h)
      fmt_src = File.read(fmt_base_h)
      if fmt_src.include?('#  define FMT_CONSTEVAL consteval')
        fmt_src = fmt_src.sub('#  define FMT_CONSTEVAL consteval', '#  define FMT_CONSTEVAL /* consteval disabled: Xcode 26 clang */')
        File.chmod(0644, fmt_base_h)
        File.write(fmt_base_h, fmt_src)
        Pod::UI.puts '[withFmtConstevalFix] Patched fmt base.h to disable consteval'
      end
    end
`;

const ANCHOR = 'post_install do |installer|';

module.exports = function withFmtConstevalFix(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfilePath, 'utf8');

      if (contents.includes('fmt_base_h')) {
        return config; // already applied
      }
      if (contents.includes(ANCHOR)) {
        contents = contents.replace(ANCHOR, ANCHOR + '\n' + SNIPPET);
        fs.writeFileSync(podfilePath, contents);
      } else {
        console.warn(
          '[withFmtConstevalFix] Could not find post_install anchor in Podfile; fmt fix not applied.'
        );
      }
      return config;
    },
  ]);
};
