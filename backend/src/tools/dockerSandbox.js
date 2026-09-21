const { spawnSync } = require('child_process')
const config = require('../config')

function dockerStatus() {
  const version = spawnSync('docker', ['--version'], { encoding: 'utf8', timeout: 3000, shell: false })
  if (version.error) {
    return { ok: false, status: 'missing_cli', image: config.dockerSandbox.image, message: 'Docker CLI not found. Install Docker Desktop to enable isolated pytest.' }
  }
  if (version.status !== 0) {
    return { ok: false, status: 'cli_error', image: config.dockerSandbox.image, message: version.stderr || version.stdout }
  }
  const image = spawnSync('docker', ['image', 'inspect', config.dockerSandbox.image], { encoding: 'utf8', timeout: 5000, shell: false })
  if (image.status !== 0) {
    return { ok: false, status: 'image_missing_or_daemon_down', image: config.dockerSandbox.image, version: version.stdout.trim(), message: image.stderr || 'Build the sandbox image before strict Docker runs.' }
  }
  return { ok: true, status: 'ready', image: config.dockerSandbox.image, version: version.stdout.trim() }
}

module.exports = { dockerStatus }
