import argparse
import time

from .loader import seed_database


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reset", action="store_true")
    parser.add_argument("--fresh-solve", action="store_true")
    args = parser.parse_args()
    started = time.time()
    seed_database(reset=args.reset, use_snapshot=not args.fresh_solve)
    print(f"Seeded in {time.time() - started:.1f}s")


if __name__ == "__main__":
    main()
