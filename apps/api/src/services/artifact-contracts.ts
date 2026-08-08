export type ArtifactUrlSigner = (key: string) => Promise<string>;

export interface ArtifactUploader {
  uploadArtifact(key: string, pdf: Buffer): Promise<void>;
}
