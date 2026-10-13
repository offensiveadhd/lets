"""lets sandbox guard for Python programs run by the engine (docs/RUNNER.md).

Started as `python -I -B _lets_guard.py main.py` inside the job folder. It
installs an audit hook and then runs main.py as __main__. The policy is
default-deny: an audit event is allowed only when it is on the allowlist
below, and path-taking events are allowed only for paths inside the job
folder (reads of the Python installation itself are allowed too, so imports
of the standard library and installed packages keep working). Everything
else raises RuntimeError("blocked by the lets sandbox: <event>") in the
program: sockets and every network client in the standard library,
subprocesses in all their forms (subprocess, os.system/exec*/spawn*/fork,
posix_spawn, pty, _winapi.CreateProcess), ctypes, winreg, dll loading,
sqlite extensions, and the import of ctypes, multiprocessing, pty and
webbrowser (modules compiled into the interpreter, such as socket,
subprocess, winreg or _winapi, raise no import event: they can be imported,
every use of them is blocked).

What it does not do: a program may still add its own *observer* audit hooks
(CPython never lets a hook block sys.addaudithook), but it cannot remove or
precede this one; CPU and memory are limited only by the engine's timeout and
output cap. It is a guard rail, not a VM.
"""
import os
import sys

JOB = os.path.realpath(os.getcwd())
PREFIXES = tuple(sorted({os.path.realpath(p) for p in (sys.prefix, sys.base_prefix, sys.exec_prefix, sys.base_exec_prefix, os.path.dirname(sys.executable)) if p}))
DEVNULL = {os.devnull, os.devnull.lower(), "nul", "/dev/null", "/dev/urandom", "/dev/random", "/dev/zero"}
READ_MODES = set("rbtU")
WRITE_FLAGS = os.O_WRONLY | os.O_RDWR | os.O_APPEND | os.O_CREAT | os.O_TRUNC

BLOCKED_IMPORTS = {"ctypes", "_ctypes", "multiprocessing", "_multiprocessing", "winreg", "_winreg", "pty", "webbrowser", "_winapi", "_overlapped", "_posixsubprocess"}

# events that are always fine: the interpreter's own machinery, introspection, in-process data
ALLOW = {
    "compile", "exec", "code.__new__", "function.__new__", "array.__new__", "mmap.__new__",
    "object.__getattr__", "object.__setattr__", "object.__delattr__",
    "builtins.id", "builtins.input", "builtins.input/result", "builtins.breakpoint", "pdb.Pdb",
    "marshal.dumps", "marshal.load", "marshal.loads", "pickle.find_class",
    "gc.get_objects", "gc.get_referents", "gc.get_referrers",
    "sys._getframe", "sys._getframemodulename", "sys._current_frames", "sys._current_exceptions",
    "sys.excepthook", "sys.unraisablehook", "sys.setprofile", "sys.settrace", "sys.setrecursionlimit",
    "sys.set_asyncgen_hooks_finalizer", "sys.set_asyncgen_hooks_firstiter", "sys.addaudithook",
    "os.putenv", "os.unsetenv", "os.lockf", "resource.setrlimit", "resource.prlimit",
    "msvcrt.get_osfhandle", "msvcrt.open_osfhandle", "msvcrt.locking", "fcntl.fcntl", "fcntl.flock", "fcntl.ioctl", "fcntl.lockf",
    "sqlite3.connect/handle", "time.sleep",
}
ALLOW_PREFIXES = ("cpython.",)

# path-taking events: (index of the path argument, is it a write?); pairs check both arguments
PATH_EVENTS = {
    "os.remove": (0, True), "os.unlink": (0, True), "os.rmdir": (0, True), "os.mkdir": (0, True), "os.chmod": (0, True),
    "os.chown": (0, True), "os.truncate": (0, True), "os.utime": (0, True), "os.chdir": (0, False), "os.listdir": (0, False),
    "os.scandir": (0, False), "os.walk": (0, False), "os.fwalk": (0, False), "os.getxattr": (0, False), "os.listxattr": (0, False),
    "os.setxattr": (0, True), "os.removexattr": (0, True), "os.chflags": (0, True), "os.lchflags": (0, True),
    "glob.glob": (0, False), "glob.glob/2": (0, False), "pathlib.Path.glob": (1, False), "pathlib.Path.rglob": (1, False),
    "shutil.rmtree": (0, True), "shutil.chown": (0, True), "shutil.unpack_archive": (1, True), "shutil.make_archive": (0, True),
    "tempfile.mkstemp": (0, True), "tempfile.mkdtemp": (0, True), "sqlite3.connect": (0, True),
    "os.link": (1, True), "os.symlink": (1, True), "os.rename": (1, True), "shutil.copyfile": (1, True), "shutil.copymode": (1, True),
    "shutil.copystat": (1, True), "shutil.copytree": (1, True), "shutil.move": (1, True),
}
PAIR_EVENTS = {"os.link", "os.symlink", "os.rename", "shutil.copyfile", "shutil.copymode", "shutil.copystat", "shutil.copytree", "shutil.move"}


def _real(p):
    if isinstance(p, bytes):
        p = os.fsdecode(p)
    if not isinstance(p, str):
        p = os.fspath(p)
    return os.path.realpath(os.path.join(JOB, p))


def _inside(real, roots):
    for root in roots:
        if real == root or real.startswith(root.rstrip(os.sep) + os.sep):
            return True
    return False


def _allowed(p, write):
    if p is None or isinstance(p, int):
        return True
    try:
        s = os.fsdecode(p) if isinstance(p, bytes) else (p if isinstance(p, str) else os.fspath(p))
    except TypeError:
        return False
    if s in DEVNULL or s.lower() in DEVNULL or s == ":memory:":
        return True
    real = _real(s)
    if _inside(real, (JOB,)):
        return True
    if not write and (_inside(real, PREFIXES) or (not sys.platform.startswith("win") and real.startswith("/dev/"))):
        return True
    return False


def _deny(event):
    raise RuntimeError("blocked by the lets sandbox: " + event)


def _hook(event, args):
    if event == "open":
        mode = args[1] if len(args) > 1 else None
        flags = args[2] if len(args) > 2 else None
        write = False
        if isinstance(mode, str) and mode:
            write = not set(mode) <= READ_MODES
        elif isinstance(flags, int):
            write = bool(flags & WRITE_FLAGS)
        if not _allowed(args[0] if args else None, write):
            _deny(event)
        return
    if event == "io.open_code":
        if not _allowed(args[0] if args else None, False):
            _deny(event)
        return
    if event == "import":
        name = args[0] if args else ""
        if isinstance(name, str) and (name in BLOCKED_IMPORTS or name.split(".")[0] in BLOCKED_IMPORTS):
            _deny(event + " " + name)
        return
    spec = PATH_EVENTS.get(event)
    if spec is not None:
        idx, write = spec
        if event in PAIR_EVENTS:
            for i in (0, 1):
                if len(args) > i and not _allowed(args[i], write):
                    _deny(event)
            return
        if len(args) > idx and not _allowed(args[idx], write):
            _deny(event)
        return
    if event in ALLOW or event.startswith(ALLOW_PREFIXES):
        return
    _deny(event)


def main():
    script = sys.argv[1] if len(sys.argv) > 1 else "main.py"
    sys.argv = [script] + sys.argv[2:]
    try:
        import resource  # POSIX only: a CPU backstop a little above the engine's wall clock
        limit = int(os.environ.get("LETS_CPU_SECONDS", "0")) or 130
        resource.setrlimit(resource.RLIMIT_CPU, (limit, limit))
    except Exception:
        pass
    import runpy  # imported before the hook: its own imports are not the program's
    sys.addaudithook(_hook)
    runpy.run_path(script, run_name="__main__")


if __name__ == "__main__":
    main()
