import { CompactScore, compressScores, decompressScores } from "./backupAndRestore.js";

test("Compress and Decompress", () => {
    const scores: CompactScore[] = [
        { u: "ryry50583583", s: 142 },
        { u: "ryry505832", s: 9999 },
    ];

    const compressed = compressScores(scores);
    const decompressed = decompressScores(compressed);

    expect(scores).toEqual(decompressed);
});
