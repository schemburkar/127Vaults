//! Measures root password verification using only disposable synthetic material.
use std::time::Instant;
use vaults_crypto::ecf1::Core;

fn main() {
    let mut template = [0_u8; 77];
    template[0] = 1;
    for (offset, seed) in [(1, 1_u8), (17, 2_u8)] {
        let mut id = [seed; 16];
        id[6] = 0x40;
        id[8] = 0x80;
        template[offset..offset + 16].copy_from_slice(&id);
    }
    template[65..69].copy_from_slice(&1_u32.to_be_bytes());
    template[69..77].copy_from_slice(&1_u64.to_be_bytes());
    let mut password = [0u8; 32];
    let mut secret = [0u8; 32];
    getrandom::fill(&mut password).expect("benchmark entropy");
    getrandom::fill(&mut secret).expect("benchmark entropy");
    let mut core = Core::new();
    let created = core.create_root(&template, &password, &secret).unwrap();
    core.lock();
    println!("Root verification: fixed 64 MiB, 3 passes, 1 lane; synthetic material only.");
    let mut elapsed = Vec::new();
    for sample in 1..=3 {
        let start = Instant::now();
        core.unwrap_root(&created.envelope, &created.context, &password, &secret)
            .unwrap();
        elapsed.push(start.elapsed().as_millis());
        core.lock();
        println!("Sample {sample}: {} ms", elapsed.last().unwrap());
    }
    elapsed.sort_unstable();
    println!("Median root verification: {} ms", elapsed[1]);
}
