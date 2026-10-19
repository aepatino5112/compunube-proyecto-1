//! gRPC transport adapter: protocol translation and error mapping only. No
//! economic rules and no storage access live here (D29).

pub mod error;
pub mod grpc;
