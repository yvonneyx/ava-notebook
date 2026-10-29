export const currentRunId = () =>
  new URLSearchParams(location.search).get('run');
export function updateRunUrl(id?: string) {
  history.replaceState(null, '', id ? `?run=${id}` : '/');
}
