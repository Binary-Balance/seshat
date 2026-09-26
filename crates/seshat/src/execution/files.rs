//! File IO for trusted, quiescent projects. Pin path traversal and operate on the
//! checked handle; this does not make a snapshot or sandbox concurrent writers.
use std::{
    fs,
    io::{Read, Write},
    path::{Component, Path},
};

pub(super) fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
        return metadata.file_type().is_symlink()
            || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0;
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

pub(super) struct RegularFile {
    file: fs::File,
    // Windows path-based opens need every ancestor pinned until IO finishes.
    #[cfg(windows)]
    _parents: Vec<fs::File>,
}

impl RegularFile {
    pub(super) fn open(path: &Path, writable: bool) -> Result<Self, String> {
        Self::open_io(path, writable).map_err(|e| format!("open {}: {e}", path.display()))
    }

    fn open_io(path: &Path, writable: bool) -> std::io::Result<Self> {
        let invalid = || std::io::Error::other("expected a regular file through real directories");
        if !path.is_absolute()
            || path
                .components()
                .any(|part| matches!(part, Component::ParentDir | Component::CurDir))
        {
            return Err(invalid());
        }
        #[cfg(unix)]
        let opened = {
            use std::{
                ffi::CString,
                os::unix::{
                    ffi::OsStrExt,
                    io::{AsRawFd, FromRawFd},
                },
            };
            let mut parent = fs::File::open("/")?;
            let mut components = path
                .components()
                .filter(|part| matches!(part, Component::Normal(_)))
                .peekable();
            let file = loop {
                let component = components.next().ok_or_else(invalid)?;
                let name = CString::new(component.as_os_str().as_bytes()).map_err(|_| invalid())?;
                let last = components.peek().is_none();
                if last {
                    #[cfg(test)]
                    super::project::file_io_hook(path, false);
                }
                let flags = libc::O_CLOEXEC
                    | libc::O_NOFOLLOW
                    | if last {
                        libc::O_NONBLOCK
                            | if writable {
                                libc::O_RDWR
                            } else {
                                libc::O_RDONLY
                            }
                    } else {
                        libc::O_RDONLY | libc::O_DIRECTORY
                    };
                // SAFETY: parent owns a live directory fd and name is NUL terminated.
                let fd = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), flags) };
                if fd < 0 {
                    return Err(std::io::Error::last_os_error());
                }
                // SAFETY: openat returned a new fd, now owned solely by this File.
                let child = unsafe { fs::File::from_raw_fd(fd) };
                if last {
                    break child;
                }
                parent = child;
            };
            Self { file }
        };
        #[cfg(windows)]
        let opened = {
            use std::os::windows::fs::OpenOptionsExt;
            use windows_sys::Win32::Storage::FileSystem::{
                FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ,
                FILE_SHARE_WRITE,
            };
            let mut current = std::path::PathBuf::new();
            let mut parents = Vec::new();
            let mut components = path.components().peekable();
            let file = loop {
                let component = components.next().ok_or_else(invalid)?;
                current.push(component.as_os_str());
                if matches!(component, Component::Prefix(_)) {
                    continue;
                }
                let last = components.peek().is_none();
                if last {
                    #[cfg(test)]
                    super::project::file_io_hook(path, false);
                }
                // Denying delete sharing pins ancestors against rename/replacement.
                // Reparse metadata can still change in place; that concurrent
                // modification is outside the trusted, quiescent input contract.
                let child = fs::OpenOptions::new()
                    .read(true)
                    .write(last && writable)
                    .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
                    .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS)
                    .open(&current)?;
                let metadata = child.metadata()?;
                if is_link(&metadata) || (!last && !metadata.is_dir()) {
                    return Err(invalid());
                }
                if last {
                    break child;
                }
                parents.push(child);
            };
            Self {
                file,
                _parents: parents,
            }
        };
        if !opened.file.metadata()?.is_file() {
            return Err(invalid());
        }
        if writable && !opened.independent()? {
            return Err(std::io::Error::other(
                "expected an independent regular file",
            ));
        }
        #[cfg(test)]
        super::project::file_io_hook(path, true);
        Ok(opened)
    }

    pub(super) fn independent(&self) -> std::io::Result<bool> {
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            Ok(self.file.metadata()?.nlink() == 1)
        }
        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawHandle;
            use windows_sys::Win32::Storage::FileSystem::{
                BY_HANDLE_FILE_INFORMATION, GetFileInformationByHandle,
            };
            let mut information = BY_HANDLE_FILE_INFORMATION::default();
            // SAFETY: the file handle is live and information is writable.
            if unsafe { GetFileInformationByHandle(self.file.as_raw_handle(), &mut information) }
                == 0
            {
                return Err(std::io::Error::last_os_error());
            }
            Ok(information.nNumberOfLinks == 1)
        }
    }

    pub(super) fn read(mut self, limit: u64) -> Result<Vec<u8>, String> {
        let mut bytes = Vec::new();
        (&mut self.file)
            .take(limit)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        Ok(bytes)
    }

    pub(super) fn copy_to(mut self, path: &Path) -> Result<u64, String> {
        // The destination belongs to an unstarted execution copy and must be new.
        let mut target = fs::File::create_new(path).map_err(|e| e.to_string())?;
        let bytes = std::io::copy(&mut self.file, &mut target).map_err(|e| e.to_string())?;
        target
            .set_permissions(
                self.file
                    .metadata()
                    .map_err(|e| e.to_string())?
                    .permissions(),
            )
            .map_err(|e| e.to_string())?;
        Ok(bytes)
    }

    pub(super) fn write(mut self, bytes: &[u8]) -> Result<(), String> {
        // Opening with truncate would change the file before checking its handle.
        self.file
            .set_len(0)
            .and_then(|()| self.file.write_all(bytes))
            .map_err(|e| e.to_string())
    }
}
