import Foundation

// Call only on a single serial queue. Immutable objects + one atomic manifest commit.
final class VaultCore {
    struct Manifest: Codable { var version: Int = 1; var objects: [String: String] = [:] }
    enum Failure: Error { case invalidKey, invalidValue, corruptManifest, unsupportedVersion, tooLarge }
    let root: URL
    private let files = FileManager.default
    var write: (Data, URL) throws -> Void = { data, url in
        #if os(iOS)
        try data.write(to: url, options: [.atomic, .completeFileProtection])
        #else
        try data.write(to: url, options: .atomic)
        #endif
    }
    init(root: URL) throws {
        self.root = root
        try files.createDirectory(at: root, withIntermediateDirectories: true)
        #if os(iOS)
        try files.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: root.path)
        #endif
        // User books are eligible for the owner's OS backup; never purgeable caches.
        if !files.fileExists(atPath: manifestURL.path) {
            guard try files.contentsOfDirectory(atPath: root.path).isEmpty else { throw Failure.corruptManifest }
            try write(JSONEncoder().encode(Manifest()), manifestURL)
        }
        _ = try manifest()
    }
    private var manifestURL: URL { root.appendingPathComponent("manifest.json") }
    private func manifest() throws -> Manifest {
        guard files.fileExists(atPath: manifestURL.path) else { throw Failure.corruptManifest }
        let result = try JSONDecoder().decode(Manifest.self, from: Data(contentsOf: manifestURL))
        guard result.version == 1 else { throw Failure.unsupportedVersion }
        guard result.objects.count <= 10000 else { throw Failure.tooLarge }
        for (key, value) in result.objects {
            try validate(key)
            guard UUID(uuidString: value) != nil else { throw Failure.corruptManifest }
            guard files.fileExists(atPath: root.appendingPathComponent(value).path) else { throw Failure.corruptManifest }
        }
        return result
    }
    private func validate(_ key: String) throws {
        guard !key.isEmpty, key.utf8.count <= 256,
              key == "preferences" || ["reading:", "summary:", "source:"].contains(where: key.hasPrefix) else { throw Failure.invalidKey }
    }
    func get(_ key: String) throws -> String? {
        try validate(key)
        guard let name = try manifest().objects[key] else { return nil }
        let data = try Data(contentsOf: root.appendingPathComponent(name))
        guard let value = String(data: data, encoding: .utf8) else { throw Failure.invalidValue }
        return value
    }
    func list(_ prefix: String) throws -> [String] {
        guard ["reading:", "summary:", "source:"].contains(prefix) else { throw Failure.invalidKey }
        let snapshot = try manifest()
        return try snapshot.objects.keys.filter { $0.hasPrefix(prefix) }.sorted().map { key in
            let data = try Data(contentsOf: root.appendingPathComponent(snapshot.objects[key]!))
            guard let value = String(data: data, encoding: .utf8) else { throw Failure.invalidValue }
            return value
        }
    }
    func commit(writes: [(String,String)], deletes: [String]) throws {
        guard writes.count <= 3001, deletes.count <= 10000 else { throw Failure.tooLarge }
        var next = try manifest()
        var total = 0
        for (key,value) in writes {
            try validate(key); total += value.utf8.count
            guard total <= 350 * 1024 * 1024, value.utf8.count <= 80 * 1024 * 1024 else { throw Failure.tooLarge }
            _ = try JSONSerialization.jsonObject(with: Data(value.utf8), options: .fragmentsAllowed)
        }
        for key in deletes { try validate(key); next.objects.removeValue(forKey: key) }
        // No filename is ever supplied by a document or the renderer.
        for (key,value) in writes {
            let name = UUID().uuidString
            try write(Data(value.utf8), root.appendingPathComponent(name))
            next.objects[key] = name
        }
        guard next.objects.count <= 10000 else { throw Failure.tooLarge }
        try write(JSONEncoder().encode(next), manifestURL)
        // After the commit, obsolete/orphaned files can be removed. Errors surface to caller.
        try collectGarbage()
    }
    func collectGarbage() throws {
        let keep = Set(try manifest().objects.values).union(["manifest.json"])
        for url in try files.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) where !keep.contains(url.lastPathComponent) {
            try files.removeItem(at: url)
        }
    }
}
