export type SshCredentialSubmitResult =
  | { status: 'accepted'; remembered: boolean }
  /** The passphrase does not unlock the key; the prompt stays open for another try. */
  | { status: 'wrong-passphrase' }
