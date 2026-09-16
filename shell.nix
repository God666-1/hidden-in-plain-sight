{
  pkgs ? import <nixpkgs> { },
}:
pkgs.mkShell {
  # This provides the Nix-native binaries to your environment
  nativeBuildInputs = with pkgs; [
    nodejs
    electron
    ffmpeg
  ];

  shellHook = ''
    # Tell npm NOT to download the broken generic linux electron binary
    export ELECTRON_SKIP_BINARY_DOWNLOAD=1
    echo "NixOS environment ready! Run 'electron .' to start the app."
  '';
}
