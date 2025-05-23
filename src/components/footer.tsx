import { SiBluesky, SiGit, SiGithub } from "@icons-pack/react-simple-icons";

export default function Footer() {
  return (
    <footer className="bg-teal-950 py-8 text-center md:text-start max-w-full border-t-2 border-border">
      <div className="container mx-auto px-4 flex flex-col md:flex-row gap-4 justify-between items-center">
        <p className="text-sm">
          Teal Computing LLC
          <br />
          A Delaware limited liability company.
          <br />
          &copy; {new Date().getFullYear()} Teal Computing LLC. All rights
          reserved.
        </p>
        <div className="flex gap-2">
          <a
            href="https://bsky.app/profile/teal.fm"
            target="_blank"
            rel="noreferrer"
            className="hover:text-[#00b7ff] transition-colors"
          >
            <SiBluesky className="h-6 w-6 mx-2 hover:text-[#00b7ff] transition-colors" />
          </a>
          <a href="https://github.com/teal-fm" target="_blank">
            <SiGithub className="h-6 w-6 mx-2 hover:text-[#fff] transition-colors" />
          </a>
          <a href="https://tangled.sh/teal.fm" target="_blank">
            <SiGit className="h-6 w-6 mx-2 hover:text-[#fff] transition-colors" />
          </a>
        </div>
      </div>
    </footer>
  );
}
