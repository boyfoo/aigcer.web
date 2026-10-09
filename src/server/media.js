import { withRepository } from "./repository.js";

export async function presignMedia(body, options) {
  return withRepository((repository) => repository.presignMedia(body), options);
}
