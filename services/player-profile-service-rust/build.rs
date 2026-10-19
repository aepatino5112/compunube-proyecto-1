//! Generates the Tonic server/client stubs for `compunube.player.v1` from the
//! shared contract in `proto/`. Stubs are never committed (see proto/README.md).

use std::{env, error::Error, path::PathBuf};

fn main() -> Result<(), Box<dyn Error>> {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR")?);
    let proto_root = manifest_dir.join("../../proto");
    let proto_file = proto_root.join("player_profile.proto");

    // Respect an explicit PROTOC override; otherwise use the vendored binary so
    // neither CI nor the Docker build needs a system protoc.
    if env::var_os("PROTOC").is_none() {
        env::set_var("PROTOC", protoc_bin_vendored::protoc_bin_path()?);
    }

    println!("cargo:rerun-if-changed={}", proto_file.display());
    println!("cargo:rerun-if-env-changed=PROTOC");

    tonic_build::configure()
        .build_client(true)
        .build_server(true)
        .compile_protos(&[proto_file], &[proto_root])?;

    Ok(())
}
