import Foundation
func check(_ condition: @autoclosure () throws -> Bool) rethrows { let result = try condition(); assert(result) }
let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
defer { try? FileManager.default.removeItem(at: root) }
let store = try VaultCore(root: root)
try store.commit(writes: [("reading:a", "{\"text\":\"first\"}"),("summary:a", "{}")], deletes: [])
try check(try store.get("reading:a") == "{\"text\":\"first\"}")
let diskWrite = store.write
store.write = { data, url in if url.lastPathComponent == "manifest.json" { throw CocoaError(.fileWriteOutOfSpace) }; try diskWrite(data,url) }
do { try store.commit(writes: [("reading:a","{\"text\":\"lost\"}"),("reading:b","{}")], deletes: ["summary:a"]); fatalError("Failure injection did not fail") } catch {}
store.write = diskWrite
let reopened = try VaultCore(root: root)
try check(try reopened.get("reading:a") == "{\"text\":\"first\"}")
try check(try reopened.get("reading:b") == nil)
try check(try reopened.get("summary:a") == "{}")
try reopened.collectGarbage()
try check(try FileManager.default.contentsOfDirectory(atPath: root.path).count == 3)
try reopened.commit(writes: [], deletes: ["reading:a","summary:a"])
try check(try reopened.list("reading:").isEmpty)
try check(try FileManager.default.contentsOfDirectory(atPath: root.path).count == 1)
do { try reopened.commit(writes: [("../../escape", "{}")], deletes: []); fatalError("Bad key accepted") } catch {}
try Data("corrupt".utf8).write(to: root.appendingPathComponent("manifest.json"))
do { _ = try VaultCore(root: root); fatalError("Corruption silently reset") } catch {}
print("PASS: atomic commit, interrupted commit, relaunch, orphan cleanup, deletion, key validation, corrupt manifest fail-closed")
// Losing the manifest must never reinterpret an existing vault as a new empty one.
try FileManager.default.removeItem(at: root.appendingPathComponent("manifest.json"))
let retained = root.appendingPathComponent(UUID().uuidString)
try Data("keep".utf8).write(to: retained)
do { _ = try VaultCore(root: root); fatalError("Missing manifest silently reset") } catch {}
assert(FileManager.default.fileExists(atPath: retained.path))
print("PASS: missing manifest does not erase existing files")
