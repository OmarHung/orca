export type DotnetContainerStatus = {
  docker: 'missing' | 'stopped' | 'running'
  container: 'none' | 'stopped' | 'running'
  /** The image the container was created from, when there is one. */
  image?: string
}
