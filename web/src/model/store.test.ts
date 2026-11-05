import { openDB } from "idb";
import { afterAll, describe, expect, it } from "vitest";
import { getAssetBlob, listTalks, newTalk, saveTalk, setStoreUser } from "./store";

afterAll(() => setStoreUser("test-user"));

describe("per-user storage", () => {
  it("keeps each account's talks separate", async () => {
    await setStoreUser("alice");
    await saveTalk(newTalk("Alice's talk"));
    await setStoreUser("bob");
    expect(await listTalks()).toEqual([]);
    await saveTalk(newTalk("Bob's talk"));
    await setStoreUser("alice");
    expect((await listTalks()).map((t) => t.title)).toEqual(["Alice's talk"]);
  });

  it("gives talks saved before accounts existed to the first account on this browser only", async () => {
    // A browser-wide database from before accounts, with a talk and an image.
    const legacy = await openDB("orator", 1, {
      upgrade(db) {
        db.createObjectStore("talks", { keyPath: "id" });
        db.createObjectStore("assets", { keyPath: "id" });
        db.createObjectStore("blobs");
      },
    });
    await legacy.put("talks", newTalk("Old talk"));
    await legacy.put("assets", { id: "abc", kind: "image", mime: "image/png", size: 3, width: 1, height: 1, source: { provider: "upload" }, createdAt: 0 });
    await legacy.put("blobs", new Blob(["png"], { type: "image/png" }), "abc");
    legacy.close();
    localStorage.clear();

    await setStoreUser("carol");
    expect((await listTalks()).map((t) => t.title)).toEqual(["Old talk"]);
    expect(await (await getAssetBlob("abc"))!.text()).toBe("png");
    expect(localStorage.getItem("orator:legacy-claimed-by")).toBe("carol");

    await setStoreUser("dave");
    expect(await listTalks()).toEqual([]);

    // The original is left in place.
    const still = await openDB("orator", 1);
    expect(await still.count("talks")).toBe(1);
    still.close();
  });
});
