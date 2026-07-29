import logoImg from "../assets/logo.avif";

type Props = {
  size?: number;
  className?: string;
  alt?: string;
};

export default function AppLogo({ size = 32, className = "", alt = "Label Anything" }: Props) {
  return (
    <img
      src={logoImg}
      alt={alt}
      className={className}
      width={size}
      height={size}
      decoding="async"
    />
  );
}
