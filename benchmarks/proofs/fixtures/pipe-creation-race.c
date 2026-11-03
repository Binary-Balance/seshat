// Linux-only probe: widen macOS's pipe-before-close-on-exec window in Rust's real spawn path.
#define _GNU_SOURCE
#include <assert.h>
#include <fcntl.h>
#include <pthread.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>

int pipe2(int fds[2], int flags) {
    static __thread int widened;
    char name[16] = {0};
    assert(pthread_getname_np(pthread_self(), name, sizeof(name)) == 0);
    if ((flags & O_CLOEXEC) && !widened && strcmp(name, "pipe-owner") == 0) {
        widened = 1;
        int result = syscall(SYS_pipe2, fds, flags & ~O_CLOEXEC);
        if (result == 0) {
            usleep(100000);
            assert(fcntl(fds[0], F_SETFD, FD_CLOEXEC) == 0);
            assert(fcntl(fds[1], F_SETFD, FD_CLOEXEC) == 0);
        }
        return result;
    }
    return syscall(SYS_pipe2, fds, flags);
}
