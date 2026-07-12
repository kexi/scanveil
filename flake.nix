{
  description = "GCP GitHub App security scanner PoC";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      systems = [ "aarch64-darwin" "x86_64-darwin" "x86_64-linux" "aarch64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      devShells = forAllSystems (system:
        let
          pkgs = import nixpkgs {
            inherit system;
            config.allowUnfree = true;
          };
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_22
              pkgs.python312
              pkgs.uv
              pkgs.ruff
              pkgs.pnpm
              pkgs.just
              pkgs.fish
              pkgs.firebase-tools
              pkgs.gitleaks
              pkgs.lefthook
              pkgs.oxfmt
              pkgs.oxlint
              pkgs.osv-scanner
              pkgs.terraform
              pkgs.google-cloud-sdk
              pkgs.pinact
            ];
          };
          agy-runner = pkgs.mkShell {
            packages = [
              pkgs.patchelf
              pkgs.python312
              pkgs.uv
            ];
          };
        });
    };
}
